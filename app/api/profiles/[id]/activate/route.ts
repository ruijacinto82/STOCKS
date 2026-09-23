import { NextRequest, NextResponse } from "next/server";
import { setActiveProfile } from "@/lib/profiles";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const data = await setActiveProfile(id);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao ativar perfil";
    const status = message === "Perfil não encontrado" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
