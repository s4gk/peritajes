import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/server/auth";
import {
  createAppointment,
  listAppointmentsFor,
} from "@/lib/server/appointments";
import {
  notifyAssignedPerito,
  notifyClientAppointmentConfirmed,
} from "@/lib/server/whatsapp-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STR = (max: number) => z.string().max(max);

const CreateSchema = z.object({
  scheduledAt: z.string().min(1).max(64),
  durationMinutes: z.number().int().min(15).max(600).optional(),
  ownerName: STR(200).optional(),
  ownerPhone: STR(40).optional(),
  ownerDocument: STR(40).optional(),
  plate: STR(20).optional(),
  vehicleLabel: STR(200).optional(),
  location: STR(200).optional(),
  notes: STR(2000).optional(),
  assignedUserId: STR(64).nullable().optional(),
});

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
    const user = await requireUser();
    const items = await listAppointmentsFor(user);
    return NextResponse.json({ appointments: items });
  } catch (e) {
    return unauth(e);
  }
}

export async function POST(req: Request) {
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
  const parsed = CreateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Cuerpo inválido", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const appt = await createAppointment(parsed.data, user);
    // Notificaciones WhatsApp — fire-and-forget; los templates hacen catch
    // interno para no romper el response al crear la cita.
    if (appt.assignedUserId) {
      void notifyAssignedPerito({
        peritoUserId: appt.assignedUserId,
        ownerName: appt.ownerName,
        ownerPhone: appt.ownerPhone,
        plate: appt.plate,
        vehicleLabel: appt.vehicleLabel,
        scheduledAtISO: appt.scheduledAt,
        location: appt.location,
      });
    }
    notifyClientAppointmentConfirmed({
      clientPhone: appt.ownerPhone,
      ownerName: appt.ownerName,
      plate: appt.plate,
      vehicleLabel: appt.vehicleLabel,
      scheduledAtISO: appt.scheduledAt,
      location: appt.location,
    });
    return NextResponse.json({ appointment: appt });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al crear cita" },
      { status: 400 },
    );
  }
}
