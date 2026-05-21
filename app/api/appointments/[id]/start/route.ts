import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { startInspectionFromAppointment } from "@/lib/server/appointments";

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

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  const result = await startInspectionFromAppointment(params.id, user);
  if (!result) {
    return NextResponse.json(
      { error: "Cita no encontrada o sin permisos" },
      { status: 404 },
    );
  }
  return NextResponse.json(result);
}
