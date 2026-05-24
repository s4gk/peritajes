import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { sendPushToUser } from "@/lib/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manda un push de prueba al usuario actual (a todos sus devices suscritos).
 * Útil para que el user valide que sus permisos están bien y que el push
 * llega al device. Si no llega, suele ser permiso revocado en el browser
 * o suscripción vieja sin limpiar.
 */
export async function POST() {
  try {
    const user = await requireUser();
    const res = await sendPushToUser(user.id, {
      title: "Push de prueba",
      body: `Hola ${user.fullName.split(" ")[0]} — las notificaciones están funcionando.`,
      url: "/dashboard",
      tag: "test",
    });
    return NextResponse.json(res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERROR";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
