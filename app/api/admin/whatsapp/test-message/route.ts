import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";
import {
  ADMIN_WA_ORG,
  sendSelfTestMessage,
} from "@/lib/server/whatsapp";

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
 * Manda un mensaje de prueba al mismo número conectado en la org del actor.
 * Sirve como smoke test on-demand desde el panel `/whatsapp` — el dueño
 * aprieta el botón después de escanear el QR y debe ver el texto llegar a su
 * WhatsApp en segundos.
 */
export async function POST() {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  if (user.role === "employee") {
    return NextResponse.json(
      { error: "Solo el dueño puede mandar mensajes de prueba." },
      { status: 403 },
    );
  }
  const orgId =
    user.orgId ?? (user.role === "admin" ? ADMIN_WA_ORG : null);
  if (!orgId) {
    return NextResponse.json(
      { error: "Necesitas una organización para mandar un mensaje de prueba." },
      { status: 400 },
    );
  }
  const r = sendSelfTestMessage(orgId);
  if (!r.accepted) {
    return NextResponse.json(
      { error: r.reason ?? "No se pudo encolar el mensaje" },
      { status: 400 },
    );
  }
  await logAudit(user.id, "whatsapp.test_sent", orgId);
  return NextResponse.json({ ok: true, phone: r.phone });
}
