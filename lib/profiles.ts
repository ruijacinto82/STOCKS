import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { get, put } from "@vercel/blob";

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
const ALLOWED_RANGES = new Set(["1d", "1mo", "6mo", "1y"]);

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
    .slice(0, 12);
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
  if (!Array.isArray(data.profiles) || data.profiles.length === 0) {
    return cloneDefaultData();
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
  } catch {
    return cloneDefaultData();
  }
}

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
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
  } catch {
    return null;
  }
}

async function writeProfilesToFile(data: ProfilesData): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

async function readProfilesFromBlob(): Promise<ProfilesData> {
  const result = await get(BLOB_PATH, { access: "private" });

  if (result?.statusCode !== 200) {
    const seed = (await readLocalSeedData()) ?? cloneDefaultData();
    await writeProfilesToBlob(seed);
    return seed;
  }

  const raw = await new Response(result.stream).text();
  return parseProfiles(raw);
}

async function writeProfilesToBlob(data: ProfilesData): Promise<void> {
  await put(BLOB_PATH, JSON.stringify(data, null, 2), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
  });
}

export async function readProfiles(): Promise<ProfilesData> {
  return getStorageBackend() === "blob" ? readProfilesFromBlob() : readProfilesFromFile();
}

async function writeProfiles(data: ProfilesData): Promise<void> {
  const normalized = normalizeProfilesData(data);
  if (getStorageBackend() === "blob") {
    await writeProfilesToBlob(normalized);
    return;
  }
  await writeProfilesToFile(normalized);
}

export async function createProfile(
  name: string,
  symbols: string[],
  range: string,
): Promise<ProfilesData> {
  const data = await readProfiles();
  const profile: Profile = normalizeProfile({
    id: randomUUID(),
    name,
    symbols,
    range,
  });
  data.profiles.push(profile);
  data.activeProfileId = profile.id;
  await writeProfiles(data);
  return data;
}

export async function updateProfile(
  id: string,
  updates: Partial<Pick<Profile, "name" | "symbols" | "range">>,
): Promise<ProfilesData> {
  const data = await readProfiles();
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
  await writeProfiles(data);
  return data;
}

export async function deleteProfile(id: string): Promise<ProfilesData> {
  const data = await readProfiles();
  data.profiles = data.profiles.filter((p) => p.id !== id);
  if (data.profiles.length === 0) {
    const fresh = cloneDefaultData();
    await writeProfiles(fresh);
    return fresh;
  }
  if (data.activeProfileId === id) {
    data.activeProfileId = data.profiles[0].id;
  }
  await writeProfiles(data);
  return data;
}

export async function setActiveProfile(id: string): Promise<ProfilesData> {
  const data = await readProfiles();
  if (!data.profiles.some((p) => p.id === id)) {
    throw new Error("Perfil não encontrado");
  }
  data.activeProfileId = id;
  await writeProfiles(data);
  return data;
}
