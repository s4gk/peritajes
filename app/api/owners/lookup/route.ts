import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { lookupVehicleOwner } from "@/lib/server/vehicle-owners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

/**
 * Lookup ligero para autocomplete en el wizard. Acepta `document` y/o
 * `phone`. Devuelve { owner } si hay match, { owner: null } si no — nunca
 * 404 para no inflar la barra de errores del cliente cuando no hay match
 * (caso esperado en la primera visita de un dueño).
 */
export async function GET(req: Request) {
  try {
    const actor = await requireUser();
    const url = new URL(req.url);
    const document = url.searchParams.get("document") ?? "";
    const phone = url.searchParams.get("phone") ?? "";
    const owner = await lookupVehicleOwner(actor, { document, phone });
    return NextResponse.json({ owner });
  } catch (e) {
    return fail(e);
  }
}
