import { NextResponse } from "next/server";

import {
  createUser,
  listUsers,
  requireUser,
} from "@/lib/server/auth";

export const runtime = "nodejs";

function unauth(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (msg === "FORBIDDEN")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ users: await listUsers() });
  } catch (e) {
    return unauth(e);
  }
}

export async function POST(req: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  try {
    const body = await req.json();
    // Solo admin (Vestel/desarrollo) puede promover a otros a admin. Un owner
    // crea exclusivamente owners. Defensa en profundidad — la UI ya oculta el
    // selector de rol cuando el creador no es admin.
    const requestedRole = body.role === "admin" ? "admin" : "owner";
    if (requestedRole === "admin" && actor.role !== "admin") {
      return NextResponse.json(
        { error: "Solo un administrador puede crear otro administrador." },
        { status: 403 },
      );
    }
    const user = await createUser({
      username: body.username ?? "",
      password: body.password ?? "",
      fullName: body.fullName ?? "",
      email: body.email ?? null,
      role: requestedRole,
    });
    return NextResponse.json({ user });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
