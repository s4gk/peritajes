import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/server/auth";
import {
  deleteAppointment,
  getAppointmentFor,
  updateAppointment,
} from "@/lib/server/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STR = (max: number) => z.string().max(max);

const UpdateSchema = z.object({
  scheduledAt: z.string().min(1).max(64).optional(),
  durationMinutes: z.number().int().min(15).max(600).optional(),
  ownerName: STR(200).optional(),
  ownerPhone: STR(40).optional(),
  ownerDocument: STR(40).optional(),
  plate: STR(20).optional(),
  vehicleLabel: STR(200).optional(),
  location: STR(200).optional(),
  notes: STR(2000).optional(),
  assignedUserId: STR(64).nullable().optional(),
  status: z
    .enum(["scheduled", "in_progress", "completed", "cancelled", "no_show"])
    .optional(),
});

function unauth(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (msg === "FORBIDDEN")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  const access = await getAppointmentFor(params.id, user);
  if (access.kind === "not_found")
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (access.kind === "forbidden")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  return NextResponse.json({ appointment: access.appointment });
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = UpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Cuerpo inválido", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const updated = await updateAppointment(params.id, parsed.data, user);
    if (!updated) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    return NextResponse.json({ appointment: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al actualizar cita" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  // Política del 2026-05: SOLO el admin puede eliminar citas. Owner/employee
  // que necesiten "cancelar" una cita deben hacerlo vía PATCH status=cancelled
  // (mantiene la fila para auditoría y para que reminders_sent no se pierda).
  if (user.role !== "admin") {
    return NextResponse.json(
      {
        error:
          "Solo el administrador puede eliminar citas. Cancelala desde la cita si querés sacarla del calendario.",
      },
      { status: 403 },
    );
  }
  const ok = await deleteAppointment(params.id, user);
  if (!ok) {
    return NextResponse.json({ error: "No encontrado o sin permisos" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
