import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  createImpersonateSession,
  getUserById,
  requireAdmin,
  setSessionCookie,
} from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin entra como otro user. Body vacío. La cookie se reemplaza con la
 * sesión impersonate (1h de vida); la sesión admin original queda viva en
 * BD para restaurarse al salir.
 */
export async function POST(_req: Request, ctx: { params: { userId: string } }) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERROR";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  const target = await getUserById(ctx.params.userId);
  if (!target) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }
  if (target.role === "admin") {
    return NextResponse.json(
      { error: "No tiene sentido impersonar a otro admin." },
      { status: 400 },
    );
  }
  const currentSid = cookies().get(SESSION_COOKIE)?.value;
  if (!currentSid) {
    return NextResponse.json(
      { error: "Sesión admin no encontrada en cookie." },
      { status: 400 },
    );
  }
  const sid = await createImpersonateSession({
    adminId: admin.id,
    targetUserId: target.id,
    originalSessionId: currentSid,
  });
  setSessionCookie(sid);
  await logAudit(
    admin.id,
    "impersonate.start",
    JSON.stringify({ targetUserId: target.id, username: target.username }),
  );
  return NextResponse.json({ ok: true, target: { id: target.id, fullName: target.fullName } });
}
