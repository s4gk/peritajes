import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";
import { getWhatsAppStatus, logoutWhatsApp } from "@/lib/server/whatsapp";

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

export async function POST() {
  let user;
  try {
    user = await requireAdmin();
  } catch (e) {
    return unauth(e);
  }
  await logoutWhatsApp();
  await logAudit(user.id, "whatsapp.logout");
  return NextResponse.json(getWhatsAppStatus());
}
