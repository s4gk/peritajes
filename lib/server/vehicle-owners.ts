import "server-only";

import crypto from "node:crypto";

import { logAudit, query } from "./db";
import type { User } from "./auth";

/**
 * Propietarios de vehículos (los dueños que aparecen en peritajes y citas).
 * NO confundir con `organizations` (los CLIENTES del SaaS — empresas que le
 * pagan a Vestel). Acá viven los dueños cuyos vehículos esas empresas
 * peritan: gente de la calle / clientes finales.
 *
 * Multi-tenant: cada org tiene su propia cartera de propietarios. Un mismo
 * documento puede existir en dos orgs y son filas distintas.
 *
 * Dedup al upsert:
 *  1. Si hay `document` no vacío → busca por (org_id, document). Match → update.
 *  2. Si no hay document pero hay `phone` → busca por (org_id, phone). Match
 *     → update; si está vacío el document del row, se rellena con el nuevo.
 *  3. Si no hay ni document ni phone → crea fila huérfana (no dedup).
 */

export type VehicleOwner = {
  id: string;
  orgId: string | null;
  document: string;
  fullName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  inspectionsCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  createdBy: string | null;
};

type Row = {
  id: string;
  org_id: string | null;
  document: string;
  full_name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  inspections_count: number;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  created_by: string | null;
};

function tsToISO(v: Date | string): string {
  return typeof v === "string" ? v : v.toISOString();
}

function rowToOwner(row: Row): VehicleOwner {
  return {
    id: row.id,
    orgId: row.org_id,
    document: row.document ?? "",
    fullName: row.full_name ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    notes: row.notes ?? "",
    inspectionsCount: Number(row.inspections_count) || 0,
    firstSeenAt: tsToISO(row.first_seen_at),
    lastSeenAt: tsToISO(row.last_seen_at),
    createdBy: row.created_by,
  };
}

function makeId(): string {
  return `vo_${crypto.randomBytes(9).toString("base64url")}`;
}

export type UpsertInput = {
  orgId: string | null;
  fullName: string;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  /** Si la fuente es un peritaje (no una cita), incrementamos inspections_count.
   *  Las citas no cuentan como peritaje hasta que se materializan. */
  incrementInspections?: boolean;
  createdBy?: string | null;
};

/**
 * Upsert idempotente. Devuelve el propietario resultante (creado o actualizado).
 *
 * Nota sobre concurrencia: usamos ON CONFLICT en el unique partial index
 * (org_id, document) WHERE document <> ''. Si dos requests insertan
 * simultáneamente al mismo documento, una gana y la otra hace UPDATE. Si NO
 * hay document, no usamos ON CONFLICT — buscamos por phone y caemos al
 * insert. En el peor caso (race sin document) quedan dos filas para el mismo
 * teléfono — el admin puede mergear desde la UI (futuro).
 */
export async function upsertVehicleOwner(input: UpsertInput): Promise<VehicleOwner | null> {
  const fullName = (input.fullName ?? "").trim();
  const document = (input.document ?? "").trim();
  const phone = (input.phone ?? "").trim();
  const email = (input.email ?? "").trim();
  const address = (input.address ?? "").trim();
  const notes = (input.notes ?? "").trim();

  // Sin nombre no creamos nada — sería un registro sin valor de búsqueda.
  if (!fullName && !document && !phone) return null;

  const inc = input.incrementInspections ? 1 : 0;

  // Caso 1: hay documento → buscar por (org_id, document).
  // NO usamos ON CONFLICT porque cuando org_id es NULL, PostgreSQL considera
  // NULL != NULL en unique constraints y nunca dispara el DO UPDATE, creando
  // duplicados. Usamos IS NOT DISTINCT FROM que sí trata NULL==NULL.
  if (document) {
    const existing = await query<Row>(
      `SELECT * FROM vehicle_owners
        WHERE org_id IS NOT DISTINCT FROM $1
          AND document = $2
        LIMIT 1`,
      [input.orgId, document],
    );
    if (existing.rows[0]) {
      const r = await query<Row>(
        `UPDATE vehicle_owners SET
            full_name = CASE WHEN $2 <> '' THEN $2 ELSE full_name END,
            phone     = CASE WHEN $3 <> '' THEN $3 ELSE phone     END,
            email     = CASE WHEN $4 <> '' THEN $4 ELSE email     END,
            address   = CASE WHEN $5 <> '' THEN $5 ELSE address   END,
            notes     = CASE WHEN $6 <> '' THEN $6 ELSE notes     END,
            inspections_count = inspections_count + $7,
            last_seen_at = now()
          WHERE id = $1
          RETURNING *`,
        [existing.rows[0].id, fullName, phone, email, address, notes, inc],
      );
      return r.rows[0] ? rowToOwner(r.rows[0]) : null;
    }
    const r = await query<Row>(
      `INSERT INTO vehicle_owners
         (id, org_id, document, full_name, phone, email, address, notes,
          inspections_count, first_seen_at, last_seen_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now(), $10)
       RETURNING *`,
      [makeId(), input.orgId, document, fullName, phone, email, address, notes, inc, input.createdBy ?? null],
    );
    return r.rows[0] ? rowToOwner(r.rows[0]) : null;
  }

  // Caso 2: hay teléfono (pero no document) → buscar por (org_id, phone).
  if (phone) {
    const existing = await query<Row>(
      `SELECT * FROM vehicle_owners
        WHERE org_id IS NOT DISTINCT FROM $1
          AND phone = $2 AND document = ''
        ORDER BY first_seen_at ASC
        LIMIT 1`,
      [input.orgId, phone],
    );
    if (existing.rows[0]) {
      const id = existing.rows[0].id;
      const r = await query<Row>(
        `UPDATE vehicle_owners SET
            full_name = CASE WHEN $2 <> '' THEN $2 ELSE full_name END,
            email     = CASE WHEN $3 <> '' THEN $3 ELSE email END,
            address   = CASE WHEN $4 <> '' THEN $4 ELSE address END,
            notes     = CASE WHEN $5 <> '' THEN $5 ELSE notes END,
            inspections_count = inspections_count + $6,
            last_seen_at = now()
          WHERE id = $1
          RETURNING *`,
        [id, fullName, email, address, notes, inc],
      );
      return r.rows[0] ? rowToOwner(r.rows[0]) : null;
    }
  }

  // Caso 3: no hay document ni match por phone → crear fila nueva.
  const r = await query<Row>(
    `INSERT INTO vehicle_owners
       (id, org_id, document, full_name, phone, email, address, notes,
        inspections_count, first_seen_at, last_seen_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now(), $10)
     RETURNING *`,
    [
      makeId(),
      input.orgId,
      document,
      fullName,
      phone,
      email,
      address,
      notes,
      inc,
      input.createdBy ?? null,
    ],
  );
  return r.rows[0] ? rowToOwner(r.rows[0]) : null;
}

/** Lista propietarios respetando scope del actor (admin = todos, owner y
 *  employee = los de su org). Soporta búsqueda por substring case-insensitive
 *  en full_name + match exacto en document/phone. */
export async function listVehicleOwners(
  actor: User,
  search?: string,
): Promise<VehicleOwner[]> {
  const filters: string[] = [];
  const params: unknown[] = [];

  if (actor.role !== "admin") {
    filters.push(`org_id = $${params.length + 1}`);
    params.push(actor.orgId);
  }
  const q = (search ?? "").trim();
  if (q) {
    const pn = params.length + 1;
    filters.push(
      `(lower(full_name) LIKE $${pn} OR document = $${pn + 1} OR phone = $${pn + 1})`,
    );
    params.push(`%${q.toLowerCase()}%`);
    params.push(q);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  // DISTINCT ON para colapsar duplicados generados por el backfill (propietarios
  // sin document ni phone crean una fila por inspección — caso 3 del upsert).
  // La clave natural es (org_id, document) si hay doc, (org_id, phone) si hay
  // phone, o el id propio como fallback. El CTE deduplica y el outer query
  // reordena para la vista.
  // DISTINCT ON para colapsar duplicados del backfill: agrupa por document si
  // existe, luego por phone, y como último fallback por nombre en minúsculas.
  // Usar `id` como fallback nunca colapsa (es único por fila).
  const r = await query<Row>(
    `WITH deduped AS (
       SELECT DISTINCT ON (org_id, COALESCE(NULLIF(document,''), NULLIF(phone,''), lower(full_name)))
         *
       FROM vehicle_owners ${where}
       ORDER BY org_id,
                COALESCE(NULLIF(document,''), NULLIF(phone,''), lower(full_name)),
                last_seen_at DESC
     )
     SELECT * FROM deduped
     ORDER BY last_seen_at DESC, full_name ASC
     LIMIT 500`,
    params,
  );
  return r.rows.map(rowToOwner);
}

export async function getVehicleOwner(
  actor: User,
  id: string,
): Promise<VehicleOwner | null> {
  const filters = ["id = $1"];
  const params: unknown[] = [id];
  if (actor.role !== "admin") {
    filters.push(`org_id = $${params.length + 1}`);
    params.push(actor.orgId);
  }
  const r = await query<Row>(
    `SELECT * FROM vehicle_owners WHERE ${filters.join(" AND ")} LIMIT 1`,
    params,
  );
  return r.rows[0] ? rowToOwner(r.rows[0]) : null;
}

export type OwnerInspectionLite = {
  id: string;
  plate: string | null;
  status: string;
  kind: string | null;
  createdAt: string;
  reportNumber: string | null;
  vehicleLabel: string;
  inspectorFullName: string | null;
};

/** Historial de peritajes del propietario: cualquier inspección donde
 *  data->vehicle->ownerDocument matchee, o (cuando no hay document) donde
 *  ownerPhone matchee. Scope por org del propietario. */
export async function listOwnerInspections(
  owner: VehicleOwner,
  limit = 50,
): Promise<OwnerInspectionLite[]> {
  const matchers: string[] = [];
  const params: unknown[] = [owner.orgId, limit];
  let pIdx = 3;
  if (owner.document) {
    matchers.push(`i.data->'vehicle'->>'ownerDocument' = $${pIdx++}`);
    params.push(owner.document);
  }
  if (owner.phone) {
    matchers.push(`i.data->'vehicle'->>'ownerPhone' = $${pIdx++}`);
    params.push(owner.phone);
  }
  if (matchers.length === 0) {
    // Sin documento ni teléfono no podemos vincular peritajes. Caemos a una
    // búsqueda por nombre exacto que es ruido tolerable.
    matchers.push(`i.data->'vehicle'->>'owner' = $${pIdx++}`);
    params.push(owner.fullName);
  }
  const r = await query<{
    id: string;
    plate: string | null;
    status: string;
    kind: string | null;
    created_at: Date | string;
    report_number: string | null;
    vehicle_label: string;
    inspector_full_name: string | null;
  }>(
    `SELECT i.id, i.plate, i.status,
            i.data->>'kind' AS kind,
            i.created_at, i.report_number,
            COALESCE(i.data->'vehicle'->>'make','') || ' ' ||
              COALESCE(i.data->'vehicle'->>'model','') AS vehicle_label,
            u.full_name AS inspector_full_name
       FROM inspections i
       LEFT JOIN users u ON u.id = i.user_id
      WHERE i.org_id IS NOT DISTINCT FROM $1
        AND (${matchers.join(" OR ")})
      ORDER BY i.created_at DESC
      LIMIT $2`,
    params,
  );
  return r.rows.map((row) => ({
    id: row.id,
    plate: row.plate,
    status: row.status,
    kind: row.kind,
    createdAt: tsToISO(row.created_at),
    reportNumber: row.report_number,
    vehicleLabel: row.vehicle_label.trim(),
    inspectorFullName: row.inspector_full_name,
  }));
}

/** Lookup ligero para autocomplete en el wizard: documento (preferido) o
 *  teléfono. Scope por org del actor. Devuelve null si no hay match. */
export async function lookupVehicleOwner(
  actor: User,
  args: { document?: string | null; phone?: string | null },
): Promise<VehicleOwner | null> {
  const doc = (args.document ?? "").trim();
  const phone = (args.phone ?? "").trim();
  if (!doc && !phone) return null;

  const orgScope = actor.role === "admin" ? null : actor.orgId;

  if (doc) {
    const r = await query<Row>(
      `SELECT * FROM vehicle_owners
        WHERE document = $1
          AND ($2::text IS NULL OR org_id = $2)
        LIMIT 1`,
      [doc, orgScope],
    );
    if (r.rows[0]) return rowToOwner(r.rows[0]);
  }
  if (phone) {
    const r = await query<Row>(
      `SELECT * FROM vehicle_owners
        WHERE phone = $1
          AND ($2::text IS NULL OR org_id = $2)
        ORDER BY last_seen_at DESC
        LIMIT 1`,
      [phone, orgScope],
    );
    if (r.rows[0]) return rowToOwner(r.rows[0]);
  }
  return null;
}

/**
 * Backfill one-shot: recorre inspections y appointments existentes y puebla
 * vehicle_owners. Idempotente — usa upsertVehicleOwner que dedupea. Llamado
 * desde db.ts una sola vez vía marker (similar a backfillOrganizations).
 */
export async function backfillVehicleOwners(): Promise<{
  insertedOrUpdated: number;
}> {
  let n = 0;
  // 1) Desde inspections.data.vehicle
  const insp = await query<{
    org_id: string | null;
    owner: string | null;
    document: string | null;
    phone: string | null;
    created_by: string | null;
  }>(
    `SELECT i.org_id,
            i.data->'vehicle'->>'owner' AS owner,
            i.data->'vehicle'->>'ownerDocument' AS document,
            i.data->'vehicle'->>'ownerPhone' AS phone,
            i.user_id AS created_by
       FROM inspections i
      WHERE i.data->'vehicle' IS NOT NULL`,
  );
  for (const row of insp.rows) {
    if (!row.owner && !row.document && !row.phone) continue;
    await upsertVehicleOwner({
      orgId: row.org_id,
      fullName: row.owner ?? "",
      document: row.document,
      phone: row.phone,
      createdBy: row.created_by,
      incrementInspections: true,
    });
    n++;
  }
  // 2) Desde appointments
  const appt = await query<{
    org_id: string | null;
    owner_name: string;
    owner_phone: string;
    owner_document: string;
    created_by: string | null;
  }>(
    `SELECT org_id, owner_name, owner_phone, owner_document, created_by
       FROM appointments
      WHERE owner_name <> '' OR owner_phone <> '' OR owner_document <> ''`,
  );
  for (const row of appt.rows) {
    await upsertVehicleOwner({
      orgId: row.org_id,
      fullName: row.owner_name,
      document: row.owner_document,
      phone: row.owner_phone,
      createdBy: row.created_by,
      // Citas no incrementan inspections_count (no son peritajes aún).
      incrementInspections: false,
    });
    n++;
  }
  return { insertedOrUpdated: n };
}
