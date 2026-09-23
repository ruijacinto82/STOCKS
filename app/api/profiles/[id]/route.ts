import { NextRequest, NextResponse } from "next/server";
import { deleteProfile, updateProfile } from "@/lib/profiles";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const updates: { name?: string; symbols?: string[]; range?: string } = {};

    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if (Array.isArray(body.symbols)) {
      updates.symbols = body.symbols
        .map((s: string) => String(s).trim().toUpperCase())
        .filter(Boolean);
    }
    if (typeof body.range === "string") {
      updates.range = body.range;
    }

    const data = await updateProfile(id, updates);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao atualizar perfil";
    const status = message === "Perfil não encontrado" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const data = await deleteProfile(id);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao apagar perfil";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
