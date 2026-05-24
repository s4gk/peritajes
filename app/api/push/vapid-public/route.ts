import { NextResponse } from "next/server";

import { getVapidPublicKey } from "@/lib/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Devuelve la clave pública VAPID para que el cliente pueda llamar a
 * pushManager.subscribe(). No es secreta — el cliente la necesita pero no
 * habilita nada por sí sola (sin la privada el server no puede firmar pushes).
 */
export async function GET() {
  return NextResponse.json({ publicKey: getVapidPublicKey() });
}
