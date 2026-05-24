import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import {
  getVehicleOwner,
  listOwnerInspections,
} from "@/lib/server/vehicle-owners";

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

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const actor = await requireUser();
    const owner = await getVehicleOwner(actor, ctx.params.id);
    if (!owner) {
      return NextResponse.json(
        { error: "Propietario no encontrado" },
        { status: 404 },
      );
    }
    const inspections = await listOwnerInspections(owner, 50);
    return NextResponse.json({ owner, inspections });
  } catch (e) {
    return fail(e);
  }
}
