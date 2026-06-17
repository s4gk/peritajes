import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { getMessagingStatus } from "@/lib/server/messaging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauth(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (msg === "FORBIDDEN")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

/**
 * Status de la integración de WhatsApp del proveedor activo (Meta o Twilio,
 * según MESSAGING_PROVIDER). La plataforma usa un único número empresarial para
 * todas las orgs, así que el estado es global. Solo el dueño (o admin) puede
 * consultarlo.
 */
export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  if (user.role === "employee") {
    return NextResponse.json(
      { error: "Solo el dueño administra el WhatsApp del negocio." },
      { status: 403 },
    );
  }
  return NextResponse.json(getMessagingStatus());
}
