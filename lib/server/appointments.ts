import "server-only";

import crypto from "node:crypto";

import { logAudit, query } from "./db";
import { createInspectionServer } from "./inspections";
import { resolveWaOrgId } from "./whatsapp-meta";
import { notifyClientNoShow } from "./whatsapp-notifications";
import { emptyInspection } from "@/lib/default-data";
import type { User } from "./auth";

/**
 * Agenda de peritajes — citas programadas. Una cita es la promesa de hacer un
 * peritaje (cliente acordó, hora reservada). Al "iniciar peritaje" desde la
 * cita se crea la inspection y se enlaza por `inspection_id` para no perder
 * el rastro entre la reserva y el documento final.
 */

export type AppointmentStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

const VALID_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
]);

export type Appointment = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  ownerName: string;
  ownerPhone: string;
  ownerDocument: string;
  plate: string;
  vehicleLabel: string;
  location: string;
  notes: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  inspectionId: string | null;
  status: AppointmentStatus;
  createdBy: string | null;
  orgId: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  scheduled_at: Date | string;
  duration_minutes: number;
  owner_name: string;
  owner_phone: string;
  owner_document: string;
  plate: string;
  vehicle_label: string;
  location: string;
  notes: string;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  inspection_id: string | null;
  status: string;
  created_by: string | null;
  org_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function tsToISO(v: Date | string): string {
  return typeof v === "string" ? v : v.toISOString();
}

function rowToAppointment(row: Row): Appointment {
  const status = VALID_STATUSES.has(row.status as AppointmentStatus)
    ? (row.status as AppointmentStatus)
    : "scheduled";
  return {
    id: row.id,
    scheduledAt: tsToISO(row.scheduled_at),
    durationMinutes: row.duration_minutes,
    ownerName: row.owner_name,
    ownerPhone: row.owner_phone,
    ownerDocument: row.owner_document,
    plate: row.plate,
    vehicleLabel: row.vehicle_label,
    location: row.location,
    notes: row.notes,
    assignedUserId: row.assigned_user_id,
    assignedUserName: row.assigned_user_name,
    inspectionId: row.inspection_id,
    status,
    createdBy: row.created_by,
    orgId: row.org_id,
    createdAt: tsToISO(row.created_at),
    updatedAt: tsToISO(row.updated_at),
  };
}

const SELECT_BASE = `
  SELECT a.*, u.full_name AS assigned_user_name
  FROM appointments a
  LEFT JOIN users u ON u.id = a.assigned_user_id
`;

function makeId(): string {
  return crypto.randomBytes(12).toString("base64url");
}

/**
 * Visibilidad:
 *   admin    → todas las citas (cross-org)
 *   owner    → todas las citas de su org (asignadas + sin asignar)
 *   employee → solo citas asignadas a él (no ve la cola abierta de su org;
 *              el owner es el que distribuye)
 */
export async function listAppointmentsFor(user: User): Promise<Appointment[]> {
  if (user.role === "admin") {
    const r = await query<Row>(`${SELECT_BASE} ORDER BY a.scheduled_at ASC`);
    return r.rows.map(rowToAppointment);
  }
  if (user.role === "owner") {
    const r = await query<Row>(
      `${SELECT_BASE}
       WHERE a.org_id = $1
       ORDER BY a.scheduled_at ASC`,
      [user.orgId],
    );
    return r.rows.map(rowToAppointment);
  }
  // employee: solo lo asignado a él.
  const r = await query<Row>(
    `${SELECT_BASE}
     WHERE a.assigned_user_id = $1
     ORDER BY a.scheduled_at ASC`,
    [user.id],
  );
  return r.rows.map(rowToAppointment);
}

export type AppointmentAccess =
  | { kind: "ok"; appointment: Appointment }
  | { kind: "not_found" }
  | { kind: "forbidden" };

/**
 * Acceso a una cita:
 *   admin    → todas
 *   owner    → cualquiera de su org (incluso asignadas a otros empleados,
 *              porque es el que reasigna y administra agenda).
 *   employee → solo si está asignada a él. (Las creadas por él que luego
 *              se reasignaron a otro empleado, ya NO las ve — el owner
 *              tomó control.)
 */
export async function getAppointmentFor(
  id: string,
  user: User,
): Promise<AppointmentAccess> {
  const r = await query<Row>(`${SELECT_BASE} WHERE a.id = $1`, [id]);
  if (r.rowCount === 0) return { kind: "not_found" };
  const appt = rowToAppointment(r.rows[0]);
  if (user.role === "admin") return { kind: "ok", appointment: appt };
  if (user.role === "owner") {
    return appt.orgId === user.orgId
      ? { kind: "ok", appointment: appt }
      : { kind: "forbidden" };
  }
  // employee
  return appt.assignedUserId === user.id
    ? { kind: "ok", appointment: appt }
    : { kind: "forbidden" };
}

export type CreateAppointmentInput = {
  scheduledAt: string;
  durationMinutes?: number;
  ownerName?: string;
  ownerPhone?: string;
  ownerDocument?: string;
  plate?: string;
  vehicleLabel?: string;
  location?: string;
  notes?: string;
  assignedUserId?: string | null;
};

function parseScheduledAt(raw: string): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error("La fecha y hora de la cita no son válidas.");
  }
  return d;
}

export async function createAppointment(
  input: CreateAppointmentInput,
  user: User,
): Promise<Appointment> {
  const scheduledAt = parseScheduledAt(input.scheduledAt);
  const id = makeId();
  await query(
    `INSERT INTO appointments (
       id, scheduled_at, duration_minutes,
       owner_name, owner_phone, owner_document,
       plate, vehicle_label, location, notes,
       assigned_user_id, status, created_by, org_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'scheduled', $12, $13)`,
    [
      id,
      scheduledAt.toISOString(),
      Math.max(15, Math.min(600, input.durationMinutes ?? 60)),
      (input.ownerName ?? "").trim(),
      (input.ownerPhone ?? "").trim(),
      (input.ownerDocument ?? "").trim(),
      (input.plate ?? "").trim().toUpperCase(),
      (input.vehicleLabel ?? "").trim(),
      (input.location ?? "").trim(),
      (input.notes ?? "").trim(),
      input.assignedUserId ?? null,
      user.id,
      user.orgId,
    ],
  );
  await logAudit(user.id, "appointment.created", id);
  const r = await query<Row>(`${SELECT_BASE} WHERE a.id = $1`, [id]);
  return rowToAppointment(r.rows[0]);
}

export type UpdateAppointmentInput = Partial<CreateAppointmentInput> & {
  status?: AppointmentStatus;
};

export async function updateAppointment(
  id: string,
  patch: UpdateAppointmentInput,
  user: User,
): Promise<Appointment | null> {
  const access = await getAppointmentFor(id, user);
  if (access.kind !== "ok") return null;

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (patch.scheduledAt !== undefined) {
    sets.push(`scheduled_at = $${i++}`);
    params.push(parseScheduledAt(patch.scheduledAt).toISOString());
  }
  if (patch.durationMinutes !== undefined) {
    sets.push(`duration_minutes = $${i++}`);
    params.push(Math.max(15, Math.min(600, patch.durationMinutes)));
  }
  if (patch.ownerName !== undefined) {
    sets.push(`owner_name = $${i++}`);
    params.push(patch.ownerName.trim());
  }
  if (patch.ownerPhone !== undefined) {
    sets.push(`owner_phone = $${i++}`);
    params.push(patch.ownerPhone.trim());
  }
  if (patch.ownerDocument !== undefined) {
    sets.push(`owner_document = $${i++}`);
    params.push(patch.ownerDocument.trim());
  }
  if (patch.plate !== undefined) {
    sets.push(`plate = $${i++}`);
    params.push(patch.plate.trim().toUpperCase());
  }
  if (patch.vehicleLabel !== undefined) {
    sets.push(`vehicle_label = $${i++}`);
    params.push(patch.vehicleLabel.trim());
  }
  if (patch.location !== undefined) {
    sets.push(`location = $${i++}`);
    params.push(patch.location.trim());
  }
  if (patch.notes !== undefined) {
    sets.push(`notes = $${i++}`);
    params.push(patch.notes.trim());
  }
  if (patch.assignedUserId !== undefined) {
    sets.push(`assigned_user_id = $${i++}`);
    params.push(patch.assignedUserId);
  }
  if (patch.status !== undefined) {
    if (!VALID_STATUSES.has(patch.status)) {
      throw new Error("Estado de la cita no válido.");
    }
    sets.push(`status = $${i++}`);
    params.push(patch.status);
  }
  if (sets.length === 0) return access.appointment;
  sets.push(`updated_at = now()`);
  params.push(id);
  await query(
    `UPDATE appointments SET ${sets.join(", ")} WHERE id = $${i}`,
    params,
  );
  await logAudit(user.id, "appointment.updated", id);
  const r = await query<Row>(`${SELECT_BASE} WHERE a.id = $1`, [id]);
  const updated = r.rows[0] ? rowToAppointment(r.rows[0]) : null;

  // Cuando una cita pasa a no_show, avisamos al cliente por WA para
  // ofrecerle reagendar sin perder el lead.
  if (patch.status === "no_show" && updated?.ownerPhone?.trim()) {
    const waOrgId = resolveWaOrgId(user, updated.orgId ?? null);
    notifyClientNoShow({
      clientPhone: updated.ownerPhone,
      ownerName: updated.ownerName,
      plate: updated.plate,
      orgId: waOrgId,
      inspectionId: updated.inspectionId ?? null,
    });
  }

  return updated;
}

export async function deleteAppointment(
  id: string,
  user: User,
): Promise<boolean> {
  const access = await getAppointmentFor(id, user);
  if (access.kind !== "ok") return false;
  const r = await query("DELETE FROM appointments WHERE id = $1", [id]);
  if (r.rowCount === 0) return false;
  await logAudit(user.id, "appointment.deleted", id);
  return true;
}

/**
 * Crea un peritaje seedeado con los datos de la cita y enlaza la cita al
 * peritaje. La cita pasa a `in_progress`. Si la cita ya tenía un peritaje
 * asociado lo respetamos — no creamos uno nuevo, devolvemos el existente.
 */
export async function startInspectionFromAppointment(
  id: string,
  user: User,
): Promise<{ inspectionId: string } | null> {
  const access = await getAppointmentFor(id, user);
  if (access.kind !== "ok") return null;
  const appt = access.appointment;

  if (appt.inspectionId) {
    return { inspectionId: appt.inspectionId };
  }

  const base = emptyInspection();
  const inspection = await createInspectionServer(
    {
      ...base,
      vehicle: {
        ...base.vehicle,
        plate: appt.plate,
        owner: appt.ownerName,
        ownerPhone: appt.ownerPhone,
        ownerDocument: appt.ownerDocument,
        location: appt.location,
        inspector: user.fullName,
        inspectorId: user.licenseId ?? "",
        date: new Date().toISOString().slice(0, 10),
      },
    },
    user.id,
    undefined,
    // El peritaje hereda el org de la cita. Si la cita no tiene org (legacy
    // o admin creó sin scope), cae al org del user que arranca el peritaje.
    appt.orgId ?? user.orgId ?? null,
  );

  await query(
    `UPDATE appointments
     SET inspection_id = $1,
         status = 'in_progress',
         assigned_user_id = COALESCE(assigned_user_id, $2),
         updated_at = now()
     WHERE id = $3`,
    [inspection.id, user.id, id],
  );
  await logAudit(
    user.id,
    "appointment.started",
    `${id} -> ${inspection.id}`,
  );

  return { inspectionId: inspection.id };
}
