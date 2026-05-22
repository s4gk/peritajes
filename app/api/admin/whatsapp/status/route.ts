import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { autoConnectIfPersisted, getWhatsAppStatus } from "@/lib/server/whatsapp";

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
 * Status del socket WA de la org del actor. Cada owner ve el estado de su
 * propio número (no del de otros clientes). Admin sin org ve un placeholder
 * "sin org seleccionada" — el panel /whatsapp es para que cada dueño conecte
 * su número, no para que Vestel administre cuentas ajenas.
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
  // Si tras un restart de pm2 quedaron credenciales en `.wa-auth/<orgId>/`,
  // la primera visita del owner al panel dispara la reconexión de TODAS las
  // orgs sin necesidad de QR. No bloqueamos: corre en background.
  await autoConnectIfPersisted().catch(() => {});

  if (!user.orgId) {
    return NextResponse.json({
      status: "disconnected",
      phone: null,
      qrDataUrl: null,
      connectedAt: null,
      lastError: "admin sin org seleccionada",
      queueSize: 0,
    });
  }
  return NextResponse.json(getWhatsAppStatus(user.orgId));
}
