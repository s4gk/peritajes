import { NextResponse } from "next/server";
import { z } from "zod";

import {
  clientIpFromHeaders,
  rateLimitMaybeSweep,
  rateLimitTake,
} from "@/lib/server/rate-limit";
import {
  consumeResetToken,
  getLiveResetToken,
} from "@/lib/server/password-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  password: z.string().min(8).max(200),
});

// Endpoint público (sin sesión). Limitamos por IP y por token para que no
// se pueda hacer fuerza bruta sobre tokens.
const LIMIT_PER_IP = { windowMs: 60 * 1000, max: 10 };
const LIMIT_PER_TOKEN = { windowMs: 60 * 1000, max: 5 };

export async function GET(
  _req: Request,
  { params }: { params: { token: string } },
) {
  const info = await getLiveResetToken(params.token);
  if (!info) {
    return NextResponse.json({ valid: false }, { status: 404 });
  }
  return NextResponse.json({
    valid: true,
    fullName: info.fullName,
    username: info.username,
  });
}

export async function POST(
  req: Request,
  { params }: { params: { token: string } },
) {
  rateLimitMaybeSweep();
  const ip = clientIpFromHeaders(req.headers);
  const ipLimit = rateLimitTake(`reset:ip:${ip}`, LIMIT_PER_IP);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espera un minuto." },
      { status: 429 },
    );
  }
  const tokLimit = rateLimitTake(`reset:tok:${params.token}`, LIMIT_PER_TOKEN);
  if (!tokLimit.allowed) {
    return NextResponse.json(
      { error: "Demasiados intentos sobre este enlace." },
      { status: 429 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 8 caracteres." },
      { status: 400 },
    );
  }
  try {
    const result = await consumeResetToken(params.token, parsed.data.password);
    if (!result) {
      return NextResponse.json(
        { error: "Enlace inválido o vencido." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, user: result.user });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
