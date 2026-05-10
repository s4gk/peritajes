import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createSession,
  getUserByUsername,
  setSessionCookie,
  verifyPassword,
} from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";
import {
  clientIpFromHeaders,
  rateLimitMaybeSweep,
  rateLimitReset,
  rateLimitTake,
} from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const LIMIT = { windowMs: 15 * 60 * 1000, max: 8 };

// Validación estricta: usuario corto, password con tope razonable. Sin esto un
// payload de 10MB puede atragantar bcrypt y bloquear el event loop.
const LoginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export async function POST(req: Request) {
  rateLimitMaybeSweep();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = LoginSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Usuario y contraseña son obligatorios" },
      { status: 400 },
    );
  }

  const username = parsed.data.username.trim().toLowerCase();
  const password = parsed.data.password;
  if (!username) {
    return NextResponse.json(
      { error: "Usuario y contraseña son obligatorios" },
      { status: 400 },
    );
  }

  // Bucket per IP + username so an attacker can't lock other accounts by
  // hitting from one IP, but also can't spread an attack across users.
  const ip = clientIpFromHeaders(req.headers);
  const key = `login:${ip}:${username}`;
  const limit = rateLimitTake(key, LIMIT);
  if (!limit.allowed) {
    await logAudit(null, "login.rate_limited", `${ip} ${username}`);
    return NextResponse.json(
      {
        error: `Demasiados intentos. Intenta de nuevo en ${Math.ceil(
          limit.retryAfterSec / 60,
        )} minutos.`,
      },
      {
        status: 429,
        headers: { "retry-after": String(limit.retryAfterSec) },
      },
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

  // Successful login wipes the bad-attempt counter so a long bad streak
  // followed by a good attempt doesn't leave the user one mistake away
  // from being locked out.
  rateLimitReset(key);

  const ua = req.headers.get("user-agent") ?? undefined;
  const sid = await createSession(row.id, ua);
  setSessionCookie(sid);
  await logAudit(row.id, "login.success");

  return NextResponse.json({ ok: true });
}
