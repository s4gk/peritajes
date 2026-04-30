import "server-only";

import crypto from "node:crypto";

import type { InspectionData, StoredInspection } from "@/lib/types";

import { logAudit, query } from "./db";

type InspectionRow = {
  id: string;
  user_id: string | null;
  status: string;
  plate: string | null;
  data: InspectionData;
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
    data: row.data,
  };
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

export async function updateInspectionServer(
  id: string,
  data: InspectionData,
  userId: string | null,
): Promise<StoredInspection | null> {
  const r = await query<InspectionRow>(
    `UPDATE inspections
     SET data = $2::jsonb,
         status = $3,
         plate = $4,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      JSON.stringify(data),
      data.status === "completed" ? "completed" : "draft",
      platefromData(data),
    ],
  );
  if (!r.rows[0]) return null;
  // We don't audit autosaves — just status transitions to keep the log clean.
  if (data.status === "completed") {
    await logAudit(userId, "inspection.completed", id);
  }
  return rowToStored(r.rows[0]);
}

export async function deleteInspectionServer(
  id: string,
  userId: string | null,
): Promise<boolean> {
  const r = await query("DELETE FROM inspections WHERE id = $1", [id]);
  if (r.rowCount === 0) return false;
  await logAudit(userId, "inspection.deleted", id);
  return true;
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
          await query(
            `UPDATE inspections
             SET data = $2::jsonb,
                 status = $3,
                 plate = $4,
                 updated_at = $5
             WHERE id = $1`,
            [
              row.id,
              JSON.stringify(row.data),
              row.data.status === "completed" ? "completed" : "draft",
              platefromData(row.data),
              row.updatedAt,
            ],
          );
          result.updated += 1;
        } else {
          result.skipped += 1;
        }
      } else {
        await query(
          `INSERT INTO inspections (id, user_id, status, plate, data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [
            row.id,
            userId,
            row.data.status === "completed" ? "completed" : "draft",
            platefromData(row.data),
            JSON.stringify(row.data),
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
