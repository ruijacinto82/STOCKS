import { NextRequest, NextResponse } from "next/server";
import { createProfile, readProfiles } from "@/lib/profiles";

export async function GET() {
  try {
    const data = await readProfiles();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao carregar perfis";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const symbols = Array.isArray(body.symbols)
      ? body.symbols.map((s: string) => String(s).trim().toUpperCase()).filter(Boolean)
      : [];
    const range = typeof body.range === "string" ? body.range : "1mo";

    if (!name) {
      return NextResponse.json({ error: "Nome do perfil é obrigatório" }, { status: 400 });
    }

    const data = await createProfile(name, symbols, range);
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao criar perfil";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
