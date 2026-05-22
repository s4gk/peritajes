import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";
import { connectWhatsApp, getWhatsAppStatus } from "@/lib/server/whatsapp";

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
 * Conecta el socket WA de la org del actor. Cada owner conecta SU PROPIO
 * número desde su panel — Vestel (admin) no maneja cuentas de clientes.
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
      { error: "Solo el dueño puede conectar WhatsApp." },
      { status: 403 },
    );
  }
  if (!user.orgId) {
    return NextResponse.json(
      {
        error:
          "Necesitás una organización para conectar WhatsApp. Como admin, hacelo desde la cuenta del cliente.",
      },
      { status: 400 },
    );
  }
  await connectWhatsApp(user.orgId).catch((err) => {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  });
  await logAudit(user.id, "whatsapp.connect_requested", user.orgId);
  return NextResponse.json(getWhatsAppStatus(user.orgId));
}
