import "server-only";

import crypto from "node:crypto";

import { logAudit, query } from "./db";

/**
 * Organizaciones (multi-tenant).
 *
 *  - admin       → no pertenece a ninguna org (`orgId === null`).
 *  - owner       → dueño del negocio. Es `owner_user_id` de SU org.
 *                  Ve todos los peritajes de su org (propios + empleados).
 *  - employee    → perito asalariado. Miembro de la org del owner.
 *                  Solo ve sus propios peritajes.
 *
 * Las relaciones se mantienen vía `users.org_id`. Las tablas con scope por
 * tenant (inspections, appointments, audit_log) llevan su propio `org_id`
 * para que el filtro de autorización sea un JOIN simple en lugar de un walk
 * por user_id.
 */

export type Organization = {
  id: string;
  name: string;
  ownerUserId: string | null;
  active: boolean;
  createdAt: string;
};

type OrgRow = {
  id: string;
  name: string;
  owner_user_id: string | null;
  active: boolean;
  created_at: Date | string;
};

function rowToOrg(row: OrgRow): Organization {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    active: row.active !== false,
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : row.created_at.toISOString(),
  };
}

function makeOrgId(): string {
  return `org_${crypto.randomBytes(9).toString("base64url")}`;
}

export async function listOrganizations(): Promise<Organization[]> {
  const r = await query<OrgRow>(
    "SELECT * FROM organizations ORDER BY created_at ASC",
  );
  return r.rows.map(rowToOrg);
}

export async function getOrgById(id: string): Promise<Organization | null> {
  const r = await query<OrgRow>(
    "SELECT * FROM organizations WHERE id = $1",
    [id],
  );
  return r.rows[0] ? rowToOrg(r.rows[0]) : null;
}

export type CreateOrgInput = {
  name: string;
  ownerUserId: string | null;
};

export async function createOrganization(
  input: CreateOrgInput,
  createdBy: string | null,
): Promise<Organization> {
  const name = input.name.trim();
  if (!name) throw new Error("El nombre de la organización es requerido.");

  const id = makeOrgId();
  await query(
    `INSERT INTO organizations (id, name, owner_user_id)
     VALUES ($1, $2, $3)`,
    [id, name, input.ownerUserId],
  );
  await logAudit(createdBy, "org.created", JSON.stringify({ id, name }));
  const created = await getOrgById(id);
  if (!created) throw new Error("No se pudo crear la organización.");
  return created;
}

export async function setOrgOwner(
  orgId: string,
  ownerUserId: string | null,
  changedBy: string | null,
): Promise<void> {
  await query(
    "UPDATE organizations SET owner_user_id = $1 WHERE id = $2",
    [ownerUserId, orgId],
  );
  await logAudit(
    changedBy,
    "org.owner_changed",
    JSON.stringify({ orgId, ownerUserId }),
  );
}

/** Resumen enriquecido para el panel admin: org + owner + count de empleados +
 *  count de peritajes del mes en curso (zona horaria America/Bogota — Colombia).
 *  El employees_count excluye al owner mismo (solo los que tienen role='employee'
 *  y org_id = org.id). */
export type OrganizationSummary = Organization & {
  ownerUsername: string | null;
  ownerFullName: string | null;
  employeesCount: number;
  inspectionsThisMonth: number;
};

export async function setOrganizationActive(
  orgId: string,
  active: boolean,
  changedBy: string | null,
): Promise<void> {
  await query("UPDATE organizations SET active = $1 WHERE id = $2", [
    active,
    orgId,
  ]);
  await logAudit(
    changedBy,
    active ? "org.activated" : "org.suspended",
    JSON.stringify({ orgId }),
  );
  // Al suspender, invalidamos todas las sesiones activas de la org para que
  // los users sean expulsados al próximo request. Al reactivar no hacemos
  // nada — los users vuelven a poder loguearse normalmente.
  if (!active) {
    await query(
      `DELETE FROM sessions WHERE user_id IN (
         SELECT id FROM users WHERE org_id = $1
       )`,
      [orgId],
    );
  }
}

/**
 * Borrado total de la empresa cliente. Cascadea por las FKs (ON DELETE
 * CASCADE en company_config, ON DELETE SET NULL en inspections/appointments/
 * audit_log que pasan a quedar como huérfanos cross-tenant que solo admin
 * verá). Antes de borrar la org:
 *  1. Eliminamos los users de la org (CASCADE limpia sessions).
 *  2. Limpiamos vehicle_owners (CASCADE via org_id).
 *  3. Eliminamos la fila de organizations.
 * El audit log queda con la traza del DELETE.
 */
export async function deleteOrganization(
  orgId: string,
  deletedBy: string | null,
): Promise<void> {
  await query("DELETE FROM users WHERE org_id = $1", [orgId]);
  await query("DELETE FROM organizations WHERE id = $1", [orgId]);
  await logAudit(deletedBy, "org.deleted", JSON.stringify({ orgId }));
}

type OrgSummaryRow = OrgRow & {
  owner_username: string | null;
  owner_full_name: string | null;
  employees_count: string;
  inspections_this_month: string;
};

function rowToOrgSummary(row: OrgSummaryRow): OrganizationSummary {
  return {
    ...rowToOrg(row),
    ownerUsername: row.owner_username,
    ownerFullName: row.owner_full_name,
    employeesCount: Number(row.employees_count) || 0,
    inspectionsThisMonth: Number(row.inspections_this_month) || 0,
  };
}

/** Inicio del mes en curso, en hora Colombia, como timestamp UTC. Lo
 *  embebemos directo en el SQL como expresión — la BD calcula con AT TIME ZONE
 *  para que el corte sea el día 1 a las 00:00 hora local, no UTC. */
const THIS_MONTH_START_SQL = `(date_trunc('month', (now() AT TIME ZONE 'America/Bogota')) AT TIME ZONE 'America/Bogota')`;

export async function listOrganizationsWithDetails(): Promise<OrganizationSummary[]> {
  const r = await query<OrgSummaryRow>(
    `SELECT o.*,
            u.username AS owner_username,
            u.full_name AS owner_full_name,
            (SELECT COUNT(*) FROM users e
              WHERE e.org_id = o.id AND e.role = 'employee')::text AS employees_count,
            (SELECT COUNT(*) FROM inspections i
              WHERE i.org_id = o.id
                AND i.created_at >= ${THIS_MONTH_START_SQL})::text AS inspections_this_month
     FROM organizations o
     LEFT JOIN users u ON u.id = o.owner_user_id
     ORDER BY o.created_at ASC`,
  );
  return r.rows.map(rowToOrgSummary);
}

export async function getOrgSummary(id: string): Promise<OrganizationSummary | null> {
  const r = await query<OrgSummaryRow>(
    `SELECT o.*,
            u.username AS owner_username,
            u.full_name AS owner_full_name,
            (SELECT COUNT(*) FROM users e
              WHERE e.org_id = o.id AND e.role = 'employee')::text AS employees_count,
            (SELECT COUNT(*) FROM inspections i
              WHERE i.org_id = o.id
                AND i.created_at >= ${THIS_MONTH_START_SQL})::text AS inspections_this_month
     FROM organizations o
     LEFT JOIN users u ON u.id = o.owner_user_id
     WHERE o.id = $1`,
    [id],
  );
  return r.rows[0] ? rowToOrgSummary(r.rows[0]) : null;
}

/** Estadísticas detalladas de una org para la sección "Actividad". Devuelve:
 *  - thisMonth: total + breakdown por status (completed/draft) + breakdown por
 *    kind (complete/quick/appraisal). Todos los counts son del mes en curso.
 *  - allTime: total histórico de peritajes y cuántos están finalizados. */
export type OrgStats = {
  thisMonth: {
    total: number;
    completed: number;
    draft: number;
    byKind: Record<string, number>;
  };
  allTime: {
    total: number;
    completed: number;
  };
};

export async function getOrgStats(orgId: string): Promise<OrgStats> {
  // Una sola query con agregaciones condicionales para evitar 3 roundtrips.
  // El kind vive dentro de `data` (jsonb) — extraemos con data->>'kind' y
  // si viene NULL lo agrupamos como 'unknown' (no debería pasar, defaults a
  // 'complete' en client, pero defensivo).
  const r = await query<{
    this_month_total: string;
    this_month_completed: string;
    this_month_draft: string;
    all_time_total: string;
    all_time_completed: string;
  }>(
    `SELECT
        COUNT(*) FILTER (WHERE created_at >= ${THIS_MONTH_START_SQL})::text AS this_month_total,
        COUNT(*) FILTER (WHERE created_at >= ${THIS_MONTH_START_SQL}
                          AND status = 'completed')::text AS this_month_completed,
        COUNT(*) FILTER (WHERE created_at >= ${THIS_MONTH_START_SQL}
                          AND status <> 'completed')::text AS this_month_draft,
        COUNT(*)::text AS all_time_total,
        COUNT(*) FILTER (WHERE status = 'completed')::text AS all_time_completed
     FROM inspections WHERE org_id = $1`,
    [orgId],
  );

  const k = await query<{ kind: string | null; n: string }>(
    `SELECT COALESCE(data->>'kind', 'unknown') AS kind, COUNT(*)::text AS n
     FROM inspections
     WHERE org_id = $1 AND created_at >= ${THIS_MONTH_START_SQL}
     GROUP BY 1`,
    [orgId],
  );

  const byKind: Record<string, number> = {};
  for (const row of k.rows) {
    byKind[row.kind ?? "unknown"] = Number(row.n) || 0;
  }

  const row = r.rows[0];
  return {
    thisMonth: {
      total: Number(row.this_month_total) || 0,
      completed: Number(row.this_month_completed) || 0,
      draft: Number(row.this_month_draft) || 0,
      byKind,
    },
    allTime: {
      total: Number(row.all_time_total) || 0,
      completed: Number(row.all_time_completed) || 0,
    },
  };
}

export async function renameOrganization(
  orgId: string,
  name: string,
  changedBy: string | null,
): Promise<Organization | null> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("El nombre de la organización es requerido.");
  await query("UPDATE organizations SET name = $1 WHERE id = $2", [
    trimmed,
    orgId,
  ]);
  await logAudit(
    changedBy,
    "org.renamed",
    JSON.stringify({ orgId, name: trimmed }),
  );
  return getOrgById(orgId);
}
