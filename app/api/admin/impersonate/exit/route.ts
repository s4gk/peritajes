import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  destroySession,
  readImpersonateOriginal,
  setSessionCookie,
} from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Salir del impersonate: destruye la sesión target y restaura la cookie a
 * la sesión admin original (que quedó viva en BD durante el impersonate).
 * Body vacío. No requireAdmin porque el actor "actual" es el user
 * impersonado (no admin); validamos vía la marca impersonated_by en la
 * sesión.
 */
export async function POST() {
  const currentSid = cookies().get(SESSION_COOKIE)?.value;
  if (!currentSid) {
    return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  }
  const orig = await readImpersonateOriginal(currentSid);
  if (!orig) {
    return NextResponse.json(
      { error: "Esta sesión no es un impersonate (o ya expiró)." },
      { status: 400 },
    );
  }
  await destroySession(currentSid);
  setSessionCookie(orig.originalSessionId);
  await logAudit(orig.adminId, "impersonate.exit", JSON.stringify({}));
  return NextResponse.json({ ok: true });
}
