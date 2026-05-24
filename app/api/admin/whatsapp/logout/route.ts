import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";
import {
  ADMIN_WA_ORG,
  getWhatsAppStatus,
  logoutWhatsApp,
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

export async function POST() {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  if (user.role === "employee") {
    return NextResponse.json(
      { error: "Solo el dueño puede desconectar WhatsApp." },
      { status: 403 },
    );
  }
  const orgId =
    user.orgId ?? (user.role === "admin" ? ADMIN_WA_ORG : null);
  if (!orgId) {
    return NextResponse.json(
      { error: "Sin org seleccionada." },
      { status: 400 },
    );
  }
  await logoutWhatsApp(orgId);
  await logAudit(user.id, "whatsapp.logout", orgId);
  return NextResponse.json(getWhatsAppStatus(orgId));
}
