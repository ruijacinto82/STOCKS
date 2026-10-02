import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

export interface Profile {
  id: string;
  name: string;
  symbols: string[];
  range: string;
}

export interface ProfilesData {
  profiles: Profile[];
  activeProfileId: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "profiles.json");
const BLOB_PATH = "profiles/profiles.json";
const ALLOWED_RANGES = new Set(["1d", "5d", "1mo", "6mo", "1y"]);
const MAX_SYMBOLS = 24;
const MAX_WRITE_ATTEMPTS = 5;
let fileMutationQueue: Promise<void> = Promise.resolve();

const DEFAULT_DATA: ProfilesData = {
  profiles: [
    {
      id: "default",
      name: "Principal",
      symbols: ["AAPL", "MSFT", "NVDA", "EDP.LS", "SAN.MC", "SAP.DE"],
      range: "1mo",
    },
  ],
  activeProfileId: "default",
};

function cloneDefaultData(): ProfilesData {
  return structuredClone(DEFAULT_DATA);
}

function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

function hasBlobConfiguration(): boolean {
  return (
    Boolean(process.env.BLOB_READ_WRITE_TOKEN) ||
    Boolean(process.env.BLOB_STORE_ID)
  );
}

function getStorageBackend(): "blob" | "file" {
  if (hasBlobConfiguration()) {
    return "blob";
  }

  if (isVercelRuntime()) {
    throw new Error(
      "Vercel Blob não está configurado. Liga um Blob store ao projeto e define as variáveis de ambiente antes do deploy.",
    );
  }

  return "file";
}

function normalizeSymbols(symbols: string[]): string[] {
  return symbols
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .filter((symbol, index, items) => items.indexOf(symbol) === index)
    .slice(0, MAX_SYMBOLS);
}

function normalizeRange(range: string): string {
  return ALLOWED_RANGES.has(range) ? range : "1mo";
}

function normalizeProfile(profile: Profile): Profile {
  return {
    id: profile.id,
    name: profile.name.trim() || "Sem nome",
    symbols: normalizeSymbols(profile.symbols),
    range: normalizeRange(profile.range),
  };
}

function normalizeProfilesData(data: ProfilesData): ProfilesData {
  if (
    !data ||
    !Array.isArray(data.profiles) ||
    data.profiles.length === 0 ||
    data.profiles.some(
      (profile) =>
        !profile ||
        typeof profile.id !== "string" ||
        typeof profile.name !== "string" ||
        !Array.isArray(profile.symbols) ||
        profile.symbols.some((symbol) => typeof symbol !== "string") ||
        typeof profile.range !== "string",
    )
  ) {
    throw new Error("Os dados dos perfis são inválidos. O ficheiro guardado não foi alterado.");
  }

  const profiles = data.profiles.map(normalizeProfile);
  const activeProfileId = profiles.some((profile) => profile.id === data.activeProfileId)
    ? data.activeProfileId
    : profiles[0].id;

  return { profiles, activeProfileId };
}

function parseProfiles(raw: string): ProfilesData {
  try {
    const parsed = JSON.parse(raw) as ProfilesData;
    return normalizeProfilesData(parsed);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error("Não foi possível ler os perfis guardados: JSON inválido.");
    }
    throw err;
  }
}

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    await fs.writeFile(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2), "utf-8");
  }
}

async function readProfilesFromFile(): Promise<ProfilesData> {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, "utf-8");
  return parseProfiles(raw);
}

async function readLocalSeedData(): Promise<ProfilesData | null> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    return parseProfiles(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return null;
  }
}

async function writeProfilesToFile(data: ProfilesData): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

async function readProfilesFromBlob(): Promise<{ data: ProfilesData; etag?: string }> {
  const result = await get(BLOB_PATH, { access: "private", useCache: false });

  if (!result) {
    const seed = (await readLocalSeedData()) ?? cloneDefaultData();
    return { data: seed };
  }
  if (result.statusCode !== 200) {
    throw new Error("Não foi possível obter a versão atual dos perfis guardados.");
  }

  const raw = await new Response(result.stream).text();
  return { data: parseProfiles(raw), etag: result.blob.etag };
}

async function writeProfilesToBlob(data: ProfilesData, etag?: string): Promise<void> {
  await put(BLOB_PATH, JSON.stringify(data, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: Boolean(etag),
    ifMatch: etag,
    contentType: "application/json; charset=utf-8",
  });
}

export async function readProfiles(): Promise<ProfilesData> {
  return getStorageBackend() === "blob" ? (await readProfilesFromBlob()).data : readProfilesFromFile();
}

async function mutateProfiles(
  mutate: (data: ProfilesData) => ProfilesData,
): Promise<ProfilesData> {
  if (getStorageBackend() === "blob") {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const { data, etag } = await readProfilesFromBlob();
      const updated = normalizeProfilesData(mutate(data));
      try {
        await writeProfilesToBlob(updated, etag);
        return updated;
      } catch (err) {
        if (!(err instanceof BlobPreconditionFailedError)) throw err;
      }
    }
    throw new Error("Os perfis foram alterados por outro pedido. Tenta guardar novamente.");
  }

  const operation = fileMutationQueue.then(async () => {
    const updated = normalizeProfilesData(mutate(await readProfilesFromFile()));
    await writeProfilesToFile(updated);
    return updated;
  });
  // A failed operation must not block subsequent saves; its caller still receives the error.
  fileMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function createProfile(
  name: string,
  symbols: string[],
  range: string,
): Promise<ProfilesData> {
  const profile: Profile = normalizeProfile({
    id: randomUUID(),
    name,
    symbols,
    range,
  });
  return mutateProfiles((data) => {
    data.profiles.push(profile);
    data.activeProfileId = profile.id;
    return data;
  });
}

export async function updateProfile(
  id: string,
  updates: Partial<Pick<Profile, "name" | "symbols" | "range">>,
): Promise<ProfilesData> {
  return mutateProfiles((data) => {
    const profile = data.profiles.find((p) => p.id === id);
    if (!profile) throw new Error("Perfil não encontrado");
    if (typeof updates.name === "string") {
      profile.name = updates.name.trim() || profile.name;
    }
    if (Array.isArray(updates.symbols)) {
      profile.symbols = normalizeSymbols(updates.symbols);
    }
    if (typeof updates.range === "string") {
      profile.range = normalizeRange(updates.range);
    }
    return data;
  });
}

export async function deleteProfile(id: string): Promise<ProfilesData> {
  return mutateProfiles((data) => {
    data.profiles = data.profiles.filter((p) => p.id !== id);
    if (data.profiles.length === 0) {
      return cloneDefaultData();
    }
    if (data.activeProfileId === id) {
      data.activeProfileId = data.profiles[0].id;
    }
    return data;
  });
}

export async function setActiveProfile(id: string): Promise<ProfilesData> {
  return mutateProfiles((data) => {
    if (!data.profiles.some((p) => p.id === id)) {
      throw new Error("Perfil não encontrado");
    }
    data.activeProfileId = id;
    return data;
  });
}
