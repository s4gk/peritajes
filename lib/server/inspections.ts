import "server-only";

import crypto from "node:crypto";

import { formatReportNumber } from "@/lib/company";
import type { InspectionData, StoredInspection } from "@/lib/types";

import { logAudit, query } from "./db";
import { deletePdf, savePdf } from "./pdf-storage";
import { renderInspectionPdf } from "./pdf-render";
import {
  createShareToken,
  getActiveShareTokenForInspection,
} from "./share-tokens";

type InspectionRow = {
  id: string;
  user_id: string | null;
  status: string;
  plate: string | null;
  data: InspectionData;
  report_number: string | null;
  locked_at: Date | string | null;
  pdf_path: string | null;
  pdf_sha256: string | null;
  pdf_size: number | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function tsToISO(v: Date | string): string {
  return typeof v === "string" ? v : v.toISOString();
}

function rowToStored(row: InspectionRow): StoredInspection {
  return {
    id: row.id,
    createdAt: tsToISO(row.created_at),
    updatedAt: tsToISO(row.updated_at),
    reportNumber: row.report_number ?? undefined,
    lockedAt: row.locked_at ? tsToISO(row.locked_at) : undefined,
    pdfSha256: row.pdf_sha256 ?? undefined,
    pdfSize: row.pdf_size ?? undefined,
    data: row.data,
  };
}

/**
 * Reserva el siguiente consecutivo del año dado de forma atómica. El UPSERT
 * con incremento dentro del DO UPDATE garantiza que dos peritajes finalizados
 * a la vez no compitan por el mismo número — Postgres serializa la fila.
 */
async function reserveReportNumber(year: number): Promise<string> {
  const r = await query<{ last_number: number }>(
    `INSERT INTO report_counters (year, last_number)
     VALUES ($1, 1)
     ON CONFLICT (year) DO UPDATE
       SET last_number = report_counters.last_number + 1
     RETURNING last_number`,
    [year],
  );
  return formatReportNumber(year, r.rows[0].last_number);
}

function makeId(): string {
  return crypto.randomBytes(12).toString("base64url");
}

function platefromData(data: InspectionData): string | null {
  const v = data.vehicle;
  const plate = (v?.plate || v?.vin || "").trim();
  return plate ? plate.toUpperCase() : null;
}

export async function listInspectionsServer(): Promise<StoredInspection[]> {
  const r = await query<InspectionRow>(
    "SELECT * FROM inspections ORDER BY updated_at DESC",
  );
  return r.rows.map(rowToStored);
}

export async function getInspectionServer(
  id: string,
): Promise<StoredInspection | null> {
  const r = await query<InspectionRow>(
    "SELECT * FROM inspections WHERE id = $1",
    [id],
  );
  return r.rows[0] ? rowToStored(r.rows[0]) : null;
}

/**
 * Devuelve la inspection solo si el usuario es dueño o admin. Cierra IDOR
 * en `/api/inspections/[id]` y `/api/pdf` — sin esto, cualquier perito
 * autenticado podía leer datos de otro perito con sólo conocer el ID.
 */
export async function getInspectionForUser(
  id: string,
  user: { id: string; role: string },
): Promise<StoredInspection | null> {
  if (user.role === "admin") return getInspectionServer(id);
  const r = await query<InspectionRow>(
    "SELECT * FROM inspections WHERE id = $1 AND user_id = $2",
    [id, user.id],
  );
  return r.rows[0] ? rowToStored(r.rows[0]) : null;
}

export type InspectionAccess =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "forbidden" };

/**
 * Helper liviano para chequear si el usuario tiene acceso (dueño o admin) sin
 * traer toda la fila. Útil en `/api/share`, `/api/pdf` etc.
 */
export async function checkInspectionAccess(
  id: string,
  user: { id: string; role: string },
): Promise<InspectionAccess> {
  const r = await query<{ user_id: string | null }>(
    "SELECT user_id FROM inspections WHERE id = $1",
    [id],
  );
  if (r.rowCount === 0) return { kind: "not_found" };
  if (user.role === "admin") return { kind: "ok" };
  if (r.rows[0].user_id === user.id) return { kind: "ok" };
  return { kind: "forbidden" };
}

export async function createInspectionServer(
  data: InspectionData,
  userId: string | null,
  preferredId?: string,
): Promise<StoredInspection> {
  // Accept a client-supplied ID for optimistic UI flows. The store generates
  // an ID locally and posts it so the wizard can navigate immediately without
  // awaiting the round-trip. If the ID collides we fall back to a fresh one.
  const id = preferredId && /^[A-Za-z0-9_-]{6,32}$/.test(preferredId)
    ? preferredId
    : makeId();
  try {
    const r = await query<InspectionRow>(
      `INSERT INTO inspections (id, user_id, status, plate, data)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING *`,
      [
        id,
        userId,
        data.status === "completed" ? "completed" : "draft",
        platefromData(data),
        JSON.stringify(data),
      ],
    );
    await logAudit(userId, "inspection.created", id);
    return rowToStored(r.rows[0]);
  } catch (e) {
    if (preferredId && (e as { code?: string }).code === "23505") {
      // Unique violation — generate a server-side ID and retry once.
      return createInspectionServer(data, userId);
    }
    throw e;
  }
}

export type UpdateInspectionResult =
  | { kind: "ok"; inspection: StoredInspection; justLocked: boolean }
  | { kind: "not_found" }
  | { kind: "locked"; inspection: StoredInspection };

export async function updateInspectionServer(
  id: string,
  data: InspectionData,
  userId: string | null,
): Promise<UpdateInspectionResult> {
  const existing = await query<InspectionRow>(
    "SELECT * FROM inspections WHERE id = $1",
    [id],
  );
  if (existing.rowCount === 0) return { kind: "not_found" };
  const existingRow = existing.rows[0];
  // Lock total: una vez finalizado el peritaje es inmutable. Defensa en
  // profundidad — el UI ya bloquea la edición, pero alguien con un PUT a mano
  // no debe poder pisar la fila. Cubrimos también filas legacy (status =
  // completed sin locked_at) por si acaso.
  const isLocked =
    existingRow.locked_at !== null || existingRow.status === "completed";
  if (isLocked) {
    return { kind: "locked", inspection: rowToStored(existingRow) };
  }

  const nextStatus = data.status === "completed" ? "completed" : "draft";
  const justLocking = nextStatus === "completed";

  // En la transición draft→completed asignamos consecutivo si no tiene.
  let assignedReportNumber: string | null = null;
  if (justLocking && !existingRow.report_number) {
    assignedReportNumber = await reserveReportNumber(new Date().getFullYear());
  }

  const r = await query<InspectionRow>(
    `UPDATE inspections
     SET data = $2::jsonb,
         status = $3,
         plate = $4,
         report_number = COALESCE(report_number, $5),
         locked_at = CASE WHEN $3 = 'completed' THEN COALESCE(locked_at, now()) ELSE locked_at END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      JSON.stringify(data),
      nextStatus,
      platefromData(data),
      assignedReportNumber,
    ],
  );
  if (!r.rows[0]) return { kind: "not_found" };
  if (justLocking) {
    await logAudit(
      userId,
      "inspection.completed",
      assignedReportNumber ? `${id} ${assignedReportNumber}` : id,
    );
  }
  return {
    kind: "ok",
    inspection: rowToStored(r.rows[0]),
    justLocked: justLocking,
  };
}

export type UpdateInspectionForUserResult =
  | { kind: "ok"; inspection: StoredInspection; justLocked: boolean }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "locked"; inspection: StoredInspection };

/**
 * Update con ownership check: solo dueño o admin. Cierra el IDOR de PUT
 * en `/api/inspections/[id]`.
 */
export async function updateInspectionForUser(
  id: string,
  data: InspectionData,
  user: { id: string; role: string },
): Promise<UpdateInspectionForUserResult> {
  if (user.role !== "admin") {
    const owner = await query<{ user_id: string | null }>(
      "SELECT user_id FROM inspections WHERE id = $1",
      [id],
    );
    if (owner.rowCount === 0) return { kind: "not_found" };
    if (owner.rows[0].user_id !== user.id) return { kind: "forbidden" };
  }
  return updateInspectionServer(id, data, user.id);
}

export async function deleteInspectionServer(
  id: string,
  userId: string | null,
): Promise<boolean> {
  const r = await query("DELETE FROM inspections WHERE id = $1", [id]);
  if (r.rowCount === 0) return false;
  // El share token se borra por CASCADE en DB. El PDF guardado en disco no
  // — lo limpiamos manualmente para no dejar archivos huérfanos cuando un
  // admin borra un peritaje finalizado.
  await deletePdf(id).catch((err) => {
    console.error("[inspections] deletePdf failed:", (err as Error).message);
  });
  await logAudit(userId, "inspection.deleted", id);
  return true;
}

export type DeleteInspectionResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "locked" };

/**
 * Borra con chequeo de propiedad + lock:
 *  - admin: puede borrar cualquier peritaje, finalizado o no.
 *  - owner: puede borrar SOLO borradores propios. Los finalizados son
 *    inmutables (la promesa de integridad del informe entregado al cliente);
 *    si necesita borrar uno, debe pedírselo al admin.
 */
export async function deleteInspectionForUser(
  id: string,
  user: { id: string; role: string },
): Promise<DeleteInspectionResult> {
  const row = await query<{ user_id: string | null; locked_at: Date | string | null; status: string }>(
    "SELECT user_id, locked_at, status FROM inspections WHERE id = $1",
    [id],
  );
  if (row.rowCount === 0) return { kind: "not_found" };
  const r = row.rows[0];
  const isLocked = r.locked_at !== null || r.status === "completed";

  if (user.role !== "admin") {
    if (r.user_id !== user.id) return { kind: "forbidden" };
    if (isLocked) return { kind: "locked" };
  }
  const ok = await deleteInspectionServer(id, user.id);
  return ok ? { kind: "ok" } : { kind: "not_found" };
}

/**
 * Asegura que un peritaje finalizado tenga su PDF persistido en disco. Si la
 * fila ya tiene pdf_path/pdf_sha256, no hace nada (verificación opcional).
 * Si no, lo renderiza, lo guarda y actualiza la fila con los metadatos.
 *
 * Se invoca:
 *  - desde PUT /api/inspections/[id] cuando el peritaje pasa a completed
 *    (queremos que el archivo esté listo antes de devolver la respuesta).
 *  - desde GET /api/inspections/[id]/pdf y /api/pdf como recuperación si una
 *    finalización previa quedó sin PDF (p.ej. Puppeteer falló y se reintenta).
 *
 * Devuelve la fila actualizada (con pdf_path/sha256/size si todo fue bien)
 * o lanza si la inspection no existe.
 */
export async function ensureCompletedPdf(opts: {
  inspectionId: string;
  user: { id: string; role: string };
  /** URL base del request para armar el verificationUrl del QR del PDF. */
  baseUrl: string;
}): Promise<StoredInspection> {
  const { inspectionId, user, baseUrl } = opts;
  const row = await query<InspectionRow>(
    "SELECT * FROM inspections WHERE id = $1",
    [inspectionId],
  );
  if (row.rowCount === 0) {
    throw new Error("INSPECTION_NOT_FOUND");
  }
  const r = row.rows[0];
  if (!r.locked_at && r.status !== "completed") {
    throw new Error("INSPECTION_NOT_FINALIZED");
  }
  if (r.pdf_path && r.pdf_sha256) {
    return rowToStored(r);
  }

  // Reusamos un share token activo (para que el QR del PDF apunte a la versión
  // pública verificable) o creamos uno nuevo si no hay.
  let verificationUrl: string | null = null;
  try {
    let token = await getActiveShareTokenForInspection(inspectionId);
    if (!token) {
      token = await createShareToken({
        inspectionId,
        createdBy: user.id,
      });
    }
    const base = baseUrl.replace(/\/$/, "");
    verificationUrl = `${base}/r/${token.token}`;
  } catch {
    verificationUrl = null;
  }

  const { buffer } = await renderInspectionPdf({
    data: r.data,
    verificationUrl,
    reportNumber: r.report_number ?? null,
  });
  const meta = await savePdf(inspectionId, buffer);

  const updated = await query<InspectionRow>(
    `UPDATE inspections
     SET pdf_path = $2,
         pdf_sha256 = $3,
         pdf_size = $4
     WHERE id = $1
     RETURNING *`,
    [inspectionId, meta.relativePath, meta.sha256, meta.size],
  );
  await logAudit(user.id, "inspection.pdf_persisted", `${inspectionId} ${meta.sha256.slice(0, 12)}`);
  return rowToStored(updated.rows[0]);
}

export async function duplicateInspectionServer(
  id: string,
  userId: string | null,
): Promise<StoredInspection | null> {
  const original = await getInspectionServer(id);
  if (!original) return null;
  const newData: InspectionData = {
    ...original.data,
    vehicle: { ...original.data.vehicle, plate: "" },
    status: "draft",
    completedAt: undefined,
  };
  return createInspectionServer(newData, userId);
}

export type ImportInspectionsResult = {
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
};

/**
 * Bulk import from a backup payload. Newer updatedAt wins per id.
 */
export async function importInspectionsServer(
  rows: StoredInspection[],
  userId: string | null,
): Promise<ImportInspectionsResult> {
  const result: ImportInspectionsResult = {
    added: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !row.data) {
      result.skipped += 1;
      continue;
    }
    try {
      const existing = await query<{ updated_at: Date | string }>(
        "SELECT updated_at FROM inspections WHERE id = $1",
        [row.id],
      );
      const incomingMs = Date.parse(row.updatedAt);
      const existingRow = existing.rows[0];
      if (existingRow) {
        const existingMs =
          typeof existingRow.updated_at === "string"
            ? Date.parse(existingRow.updated_at)
            : existingRow.updated_at.getTime();
        if (incomingMs > existingMs) {
          // El report_number no se sobrescribe nunca por import — si el
          // backup trae uno y la fila local no, lo adoptamos via COALESCE.
          await query(
            `UPDATE inspections
             SET data = $2::jsonb,
                 status = $3,
                 plate = $4,
                 report_number = COALESCE(report_number, $5),
                 updated_at = $6
             WHERE id = $1`,
            [
              row.id,
              JSON.stringify(row.data),
              row.data.status === "completed" ? "completed" : "draft",
              platefromData(row.data),
              row.reportNumber ?? null,
              row.updatedAt,
            ],
          );
          result.updated += 1;
        } else {
          result.skipped += 1;
        }
      } else {
        await query(
          `INSERT INTO inspections (id, user_id, status, plate, data, report_number, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
          [
            row.id,
            userId,
            row.data.status === "completed" ? "completed" : "draft",
            platefromData(row.data),
            JSON.stringify(row.data),
            row.reportNumber ?? null,
            row.createdAt,
            row.updatedAt,
          ],
        );
        result.added += 1;
      }
    } catch (e) {
      result.errors.push(
        `${row.id}: ${e instanceof Error ? e.message : "error"}`,
      );
    }
  }
  if (result.added || result.updated) {
    await logAudit(
      userId,
      "inspection.import",
      JSON.stringify({
        added: result.added,
        updated: result.updated,
        skipped: result.skipped,
      }),
    );
  }
  return result;
}
