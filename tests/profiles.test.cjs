const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("next/dist/build/swc");
const { BlobNotFoundError, BlobPreconditionFailedError } = require("@vercel/blob");

const source = readFileSync(path.join(__dirname, "..", "lib", "profiles.ts"), "utf8");
const compiled = transformSync(source, {
  jsc: { parser: { syntax: "typescript" }, target: "es2022" },
  module: { type: "commonjs" },
  isModule: true,
}).code;

function initialData() {
  return {
    profiles: [{ id: "original", name: "Original", symbols: ["AAPL"], range: "1mo" }],
    activeProfileId: "original",
  };
}

function harness({ initial = initialData(), backend = "blob", failWrites = false, raceFirstWrite = false, changeDuringRead = false, missingVersion = false } = {}) {
  let raw = initial === null ? null : typeof initial === "string" ? initial : JSON.stringify(initial);
  let version = 1;
  const stale = raw;
  let conflicts = 0;
  let writes = 0;
  let getError;
  let statusCode = 200;
  let headError;
  let changedDuringRead = false;
  const reads = [];
  const uploads = [];
  const missing = () => Object.assign(new Error("Missing file"), { code: "ENOENT" });
  const blob = {
    BlobPreconditionFailedError,
    BlobNotFoundError,
    async head() {
      if (headError) throw headError;
      if (raw === null) throw new BlobNotFoundError();
      return { etag: missingVersion ? "" : String(version) };
    },
    async get(_pathname, options) {
      reads.push(options);
      if (getError) throw getError;
      if (raw === null) return null;
      const snapshot = options.useCache === false ? raw : stale;
      const etag = `W/"download-${version}"`;
      if (changeDuringRead && !changedDuringRead) {
        changedDuringRead = true;
        const data = JSON.parse(raw);
        data.profiles.push({ id: "external", name: "External", symbols: ["NVDA"], range: "1mo" });
        raw = JSON.stringify(data);
        version++;
      }
      return {
        statusCode,
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(snapshot));
            controller.close();
          },
        }),
        blob: { etag },
      };
    },
    async put(_pathname, body, options) {
      uploads.push(options);
      if (failWrites) throw new BlobPreconditionFailedError();
      if (raceFirstWrite && raw === null) {
        raw = JSON.stringify(initialData());
        version++;
      }
      if (options.ifMatch && options.ifMatch !== String(version)) {
        conflicts++;
        throw new BlobPreconditionFailedError();
      }
      if (raw !== null && !options.allowOverwrite) throw new Error("Blob already exists");
      raw = body;
      version++;
      writes++;
    },
  };
  const fs = {
    async mkdir() {},
    async access() { if (raw === null) throw missing(); },
    async readFile() { if (raw === null) throw missing(); return raw; },
    async writeFile(_pathname, body) { raw = body; writes++; },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    require(name) {
      if (name === "@vercel/blob") return blob;
      if (name === "fs") return { promises: fs };
      return require(name);
    },
    process: { cwd: () => __dirname, env: backend === "blob" ? { BLOB_READ_WRITE_TOKEN: "test" } : {} },
    structuredClone, Response,
  });
  return {
    api: module.exports, reads, uploads,
    data: () => JSON.parse(raw),
    conflicts: () => conflicts,
    writes: () => writes,
    failRead(error) { getError = error; },
    setStatus(status) { statusCode = status; },
    failHead(error) { headError = error; },
  };
}

test("creating, editing and reloading preserve earlier profiles despite a stale CDN copy", async () => {
  const store = harness();
  const created = await store.api.createProfile("Second", ["MSFT"], "1y");
  const id = created.activeProfileId;
  await store.api.updateProfile(id, { name: "Edited", symbols: ["NVDA"] });
  await store.api.createProfile("Third", ["SAP.DE"], "6mo");
  const reloaded = await store.api.readProfiles();
  assert.deepEqual(Array.from(reloaded.profiles, p => p.name), ["Original", "Edited", "Third"]);
  assert.deepEqual(Array.from(reloaded.profiles.find(p => p.id === id).symbols), ["NVDA"]);
  assert.ok(store.reads.every(options => options.useCache === false));
  assert.ok(store.uploads.every(options => options.ifMatch && options.addRandomSuffix === false));
});

test("write preconditions use storage metadata instead of differing download ETags", async () => {
  const store = harness();
  await store.api.updateProfile("original", { name: "Edited" });
  await store.api.createProfile("New", [], "1mo");
  assert.equal(store.uploads[0].ifMatch, "1");
  assert.equal(store.uploads[1].ifMatch, "2");
  assert.equal(store.conflicts(), 0);
});

test("a version change during download retries before writing and preserves external changes", async () => {
  const store = harness({ changeDuringRead: true });
  await store.api.createProfile("New", [], "1mo");
  assert.deepEqual(store.data().profiles.map(p => p.name), ["Original", "External", "New"]);
  assert.equal(store.uploads.length, 1);
  assert.equal(store.uploads[0].ifMatch, "2");
});

test("missing metadata versions and metadata service failures cannot trigger unprotected overwrites", async () => {
  const missing = harness({ missingVersion: true });
  await assert.rejects(missing.api.createProfile("New", [], "1mo"), /versão dos perfis/);
  assert.equal(missing.uploads.length, 0);
  const failed = harness();
  failed.failHead(new Error("Metadata unavailable"));
  await assert.rejects(failed.api.updateProfile("original", { name: "Edited" }), /Metadata unavailable/);
  assert.equal(failed.uploads.length, 0);
});

test("PSI preserves all 30 requested symbols when created, edited and reloaded", async () => {
  const symbols = [
    "ALTR.LS", "BCP.LS", "SLBEN.LS", "COR.LS", "CTT.LS", "EDP.LS",
    "EDPR.LS", "ESON.LS", "FLEXD.LS", "GALP.LS", "GLINT.LS", "IBS.LS",
    "IPR.LS", "JMT.LS", "MAR.LS", "MCP.LS", "EGL.LS", "NVG.LS",
    "NOS.LS", "NBA.LS", "PHR.LS", "FCP.LS", "RAM.LS", "RENE.LS",
    "SEM.LS", "SON.LS", "SNC.LS", "SCP.LS", "TDSA.LS", "TYC.LS",
  ];
  const store = harness();
  const created = await store.api.createProfile("PSI", symbols, "1mo");
  await store.api.updateProfile(created.activeProfileId, { symbols, range: "1y" });
  const data = await store.api.readProfiles();
  assert.equal(data.profiles.length, 2);
  assert.deepEqual(Array.from(data.profiles.find(p => p.name === "PSI").symbols), symbols);
  const limited = await store.api.createProfile("Limit", [...symbols, "AAPL"], "1mo");
  assert.equal(limited.profiles.find(p => p.name === "Limit").symbols.length, 30);
});

test("concurrent autosave, create and activation retain all changes after conflict retries", async () => {
  const store = harness();
  await Promise.all([
    store.api.updateProfile("original", { symbols: ["MSFT"], range: "1y" }),
    store.api.createProfile("Second", ["NVDA"], "5d"),
    store.api.setActiveProfile("original"),
  ]);
  assert.equal(store.data().profiles.length, 2);
  assert.deepEqual(store.data().profiles[0].symbols, ["MSFT"]);
  assert.equal(store.data().profiles[0].range, "1y");
  assert.equal(store.data().activeProfileId, "original");
  assert.ok(store.conflicts() > 0);
});

test("concurrent creates keep distinct profiles", async () => {
  const store = harness();
  await Promise.all(["Second", "Third", "Fourth"].map(name => store.api.createProfile(name, [], "1mo")));
  assert.equal(store.data().profiles.length, 4);
  assert.equal(new Set(store.data().profiles.map(p => p.id)).size, 4);
});

test("only explicit deletion removes a profile and the last deletion restores the default", async () => {
  const store = harness();
  const created = await store.api.createProfile("Second", [], "1mo");
  await store.api.deleteProfile("original");
  assert.equal(store.data().profiles.length, 1);
  assert.equal(store.data().profiles[0].id, created.activeProfileId);
  await store.api.deleteProfile(created.activeProfileId);
  assert.equal(store.data().activeProfileId, "default");
});

test("missing Blob reads do not write seeds and first mutation creates without overwriting", async () => {
  const store = harness({ initial: null });
  await store.api.readProfiles();
  assert.equal(store.writes(), 0);
  await store.api.createProfile("First", [], "1mo");
  assert.equal(store.uploads[0].allowOverwrite, false);
  assert.equal(store.uploads[0].ifMatch, undefined);
  assert.equal(store.data().profiles.length, 2);
});

test("a first-write race reports failure rather than overwriting the other request's profiles", async () => {
  const store = harness({ initial: null, raceFirstWrite: true });
  await assert.rejects(store.api.createProfile("New", [], "1mo"), /already exists/);
  assert.deepEqual(store.data(), initialData());
  assert.equal(store.writes(), 0);
});

test("invalid stored JSON or profile data fails without resetting or writing", async () => {
  for (const initial of ["{broken", { profiles: [] }, { profiles: [{ id: "bad" }] }]) {
    const store = harness({ initial });
    await assert.rejects(store.api.createProfile("New", [], "1mo"), /inválid/);
    assert.equal(store.writes(), 0);
  }
});

test("storage read errors and unexpected responses never reseed the Blob", async () => {
  const store = harness();
  store.failRead(new Error("Storage unavailable"));
  await assert.rejects(store.api.createProfile("New", [], "1mo"), /Storage unavailable/);
  store.failRead(undefined);
  store.setStatus(304);
  await assert.rejects(store.api.readProfiles(), /versão atual/);
  assert.equal(store.writes(), 0);
});

test("persistent write conflicts are bounded and reported, without changing saved data", async () => {
  const store = harness({ failWrites: true });
  await assert.rejects(store.api.createProfile("New", [], "1mo"), /Tenta guardar novamente/);
  assert.equal(store.uploads.length, 5);
  assert.equal(store.writes(), 0);
  assert.equal(store.data().profiles.length, 1);
});

test("local concurrent mutations are serialized and a failed save does not block later operations", async () => {
  const store = harness({ backend: "file" });
  await assert.rejects(store.api.updateProfile("missing", { name: "Absent" }), /não encontrado/);
  await Promise.all([
    store.api.createProfile("Second", [], "1mo"),
    store.api.updateProfile("original", { symbols: [" msft ", "MSFT", ""], range: "invalid" }),
    store.api.createProfile("Third", [], "1mo"),
  ]);
  assert.equal(store.data().profiles.length, 3);
  assert.deepEqual(store.data().profiles[0].symbols, ["MSFT"]);
  assert.equal(store.data().profiles[0].range, "1mo");
});
