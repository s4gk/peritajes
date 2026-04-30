import { NextResponse } from "next/server";

import {
  createSession,
  getUserByUsername,
  setSessionCookie,
  verifyPassword,
} from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const username = (body.username ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!username || !password) {
    return NextResponse.json(
      { error: "Usuario y contraseña son obligatorios" },
      { status: 400 },
    );
  }

  const row = await getUserByUsername(username);
  if (!row || !row.active) {
    await logAudit(null, "login.failed", username);
    return NextResponse.json(
      { error: "Credenciales inválidas" },
      { status: 401 },
    );
  }

  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) {
    await logAudit(row.id, "login.failed");
    return NextResponse.json(
      { error: "Credenciales inválidas" },
      { status: 401 },
    );
  }

  const ua = req.headers.get("user-agent") ?? undefined;
  const sid = await createSession(row.id, ua);
  setSessionCookie(sid);
  await logAudit(row.id, "login.success");

  return NextResponse.json({ ok: true });
}
