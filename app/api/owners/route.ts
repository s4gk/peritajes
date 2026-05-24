import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { listVehicleOwners } from "@/lib/server/vehicle-owners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (msg === "FORBIDDEN")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function GET(req: Request) {
  try {
    const actor = await requireUser();
    const url = new URL(req.url);
    const search = url.searchParams.get("q") ?? "";
    return NextResponse.json({ owners: await listVehicleOwners(actor, search) });
  } catch (e) {
    return fail(e);
  }
}
