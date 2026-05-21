import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/server/auth";
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

export async function GET() {
  try {
    await requireAdmin();
  } catch (e) {
    return unauth(e);
  }
  // Si tras un restart de pm2 quedaron credenciales en `.wa-auth/`, la primera
  // visita del admin al panel dispara la reconexión sin necesidad de QR.
  await autoConnectIfPersisted().catch(() => {});
  return NextResponse.json(getWhatsAppStatus());
}
