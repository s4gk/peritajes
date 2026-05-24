import "server-only";

import { query } from "./db";

/**
 * Stats agregadas cross-org para el dashboard del admin (Vestel). Todas las
 * queries respetan el corte mensual en hora Colombia (America/Bogota) para
 * que "este mes" coincida con la percepción del usuario, no con UTC.
 */

const TZ = "America/Bogota";
const THIS_MONTH_START = `(date_trunc('month', (now() AT TIME ZONE '${TZ}')) AT TIME ZONE '${TZ}')`;
const PREV_MONTH_START = `((date_trunc('month', (now() AT TIME ZONE '${TZ}')) - interval '1 month') AT TIME ZONE '${TZ}')`;

export type GlobalKPIs = {
  /** Orgs con al menos 1 user activo. */
  activeOrgs: number;
  totalOrgs: number;
  inspectionsThisMonth: number;
  inspectionsPrevMonth: number;
  /** Delta porcentual vs mes pasado. null si el mes pasado fue 0. */
  deltaPct: number | null;
  completedThisMonth: number;
  draftThisMonth: number;
};

export async function getGlobalKPIs(): Promise<GlobalKPIs> {
  const r = await query<{
    total_orgs: string;
    active_orgs: string;
    this_month: string;
    prev_month: string;
    completed_this_month: string;
    draft_this_month: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM organizations)::text AS total_orgs,
       (SELECT COUNT(DISTINCT o.id)
          FROM organizations o
          JOIN users u ON u.org_id = o.id
         WHERE u.active = TRUE)::text AS active_orgs,
       (SELECT COUNT(*) FROM inspections
         WHERE created_at >= ${THIS_MONTH_START})::text AS this_month,
       (SELECT COUNT(*) FROM inspections
         WHERE created_at >= ${PREV_MONTH_START}
           AND created_at <  ${THIS_MONTH_START})::text AS prev_month,
       (SELECT COUNT(*) FROM inspections
         WHERE created_at >= ${THIS_MONTH_START}
           AND status = 'completed')::text AS completed_this_month,
       (SELECT COUNT(*) FROM inspections
         WHERE created_at >= ${THIS_MONTH_START}
           AND status <> 'completed')::text AS draft_this_month`,
  );
  const row = r.rows[0];
  const thisMonth = Number(row.this_month) || 0;
  const prevMonth = Number(row.prev_month) || 0;
  const deltaPct =
    prevMonth > 0 ? Math.round(((thisMonth - prevMonth) / prevMonth) * 100) : null;
  return {
    totalOrgs: Number(row.total_orgs) || 0,
    activeOrgs: Number(row.active_orgs) || 0,
    inspectionsThisMonth: thisMonth,
    inspectionsPrevMonth: prevMonth,
    deltaPct,
    completedThisMonth: Number(row.completed_this_month) || 0,
    draftThisMonth: Number(row.draft_this_month) || 0,
  };
}

export type TopOrg = {
  id: string;
  name: string;
  ownerFullName: string | null;
  count: number;
};

export async function getTopOrgsThisMonth(limit = 10): Promise<TopOrg[]> {
  const r = await query<{
    id: string;
    name: string;
    owner_full_name: string | null;
    n: string;
  }>(
    `SELECT o.id, o.name, u.full_name AS owner_full_name,
            COUNT(i.id)::text AS n
     FROM organizations o
     LEFT JOIN users u ON u.id = o.owner_user_id
     LEFT JOIN inspections i
            ON i.org_id = o.id
           AND i.created_at >= ${THIS_MONTH_START}
     GROUP BY o.id, o.name, u.full_name
     ORDER BY n DESC, o.created_at ASC
     LIMIT $1`,
    [limit],
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    ownerFullName: row.owner_full_name,
    count: Number(row.n) || 0,
  }));
}

export type MonthBucket = {
  /** YYYY-MM, ej "2026-05". */
  key: string;
  /** "May 2026" formato corto. */
  label: string;
  count: number;
};

/** Devuelve los últimos `months` meses (incluyendo el actual) con su count.
 *  Aunque un mes no tenga peritajes, sale en el array con count=0 para que
 *  el gráfico tenga gaps visibles. */
export async function getMonthlyTrend(months = 6): Promise<MonthBucket[]> {
  const r = await query<{ month_key: string; n: string }>(
    `WITH ms AS (
       SELECT generate_series(
         date_trunc('month', (now() AT TIME ZONE '${TZ}')) - ((($1::int - 1)) * interval '1 month'),
         date_trunc('month', (now() AT TIME ZONE '${TZ}')),
         interval '1 month'
       )::date AS m
     )
     SELECT to_char(ms.m, 'YYYY-MM') AS month_key,
            COUNT(i.id)::text AS n
     FROM ms
     LEFT JOIN inspections i
       ON to_char((i.created_at AT TIME ZONE '${TZ}')::date, 'YYYY-MM') = to_char(ms.m, 'YYYY-MM')
     GROUP BY ms.m
     ORDER BY ms.m ASC`,
    [months],
  );

  return r.rows.map((row) => {
    const [y, m] = row.month_key.split("-").map(Number);
    const label = new Date(y, m - 1, 1).toLocaleDateString("es-CO", {
      month: "short",
      year: "2-digit",
    });
    return { key: row.month_key, label, count: Number(row.n) || 0 };
  });
}

/** Trend de UNA org puntual (para el detalle /clientes/[id]). */
export async function getOrgMonthlyTrend(
  orgId: string,
  months = 6,
): Promise<MonthBucket[]> {
  const r = await query<{ month_key: string; n: string }>(
    `WITH ms AS (
       SELECT generate_series(
         date_trunc('month', (now() AT TIME ZONE '${TZ}')) - ((($2::int - 1)) * interval '1 month'),
         date_trunc('month', (now() AT TIME ZONE '${TZ}')),
         interval '1 month'
       )::date AS m
     )
     SELECT to_char(ms.m, 'YYYY-MM') AS month_key,
            COUNT(i.id)::text AS n
     FROM ms
     LEFT JOIN inspections i
       ON i.org_id = $1
      AND to_char((i.created_at AT TIME ZONE '${TZ}')::date, 'YYYY-MM') = to_char(ms.m, 'YYYY-MM')
     GROUP BY ms.m
     ORDER BY ms.m ASC`,
    [orgId, months],
  );
  return r.rows.map((row) => {
    const [y, m] = row.month_key.split("-").map(Number);
    const label = new Date(y, m - 1, 1).toLocaleDateString("es-CO", {
      month: "short",
      year: "2-digit",
    });
    return { key: row.month_key, label, count: Number(row.n) || 0 };
  });
}

export async function getKindBreakdownThisMonth(): Promise<Record<string, number>> {
  const r = await query<{ kind: string; n: string }>(
    `SELECT COALESCE(data->>'kind', 'unknown') AS kind, COUNT(*)::text AS n
     FROM inspections
     WHERE created_at >= ${THIS_MONTH_START}
     GROUP BY 1`,
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) out[row.kind] = Number(row.n) || 0;
  return out;
}

export type OrgAlert = {
  id: string;
  name: string;
  ownerFullName: string | null;
  lastInspectionAt: string | null;
};

/** Orgs sin ningún peritaje creado este mes. Útil para detectar churn. */
export async function getOrgsInAlert(): Promise<OrgAlert[]> {
  const r = await query<{
    id: string;
    name: string;
    owner_full_name: string | null;
    last_inspection_at: Date | string | null;
  }>(
    `SELECT o.id, o.name, u.full_name AS owner_full_name,
            (SELECT MAX(i.created_at) FROM inspections i WHERE i.org_id = o.id) AS last_inspection_at
     FROM organizations o
     LEFT JOIN users u ON u.id = o.owner_user_id
     WHERE NOT EXISTS (
       SELECT 1 FROM inspections i
        WHERE i.org_id = o.id
          AND i.created_at >= ${THIS_MONTH_START}
     )
     ORDER BY last_inspection_at DESC NULLS LAST`,
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    ownerFullName: row.owner_full_name,
    lastInspectionAt:
      row.last_inspection_at === null
        ? null
        : typeof row.last_inspection_at === "string"
          ? row.last_inspection_at
          : row.last_inspection_at.toISOString(),
  }));
}

export type NewOrg = {
  id: string;
  name: string;
  ownerFullName: string | null;
  createdAt: string;
};

export async function getNewOrgsThisMonth(): Promise<NewOrg[]> {
  const r = await query<{
    id: string;
    name: string;
    owner_full_name: string | null;
    created_at: Date | string;
  }>(
    `SELECT o.id, o.name, u.full_name AS owner_full_name, o.created_at
     FROM organizations o
     LEFT JOIN users u ON u.id = o.owner_user_id
     WHERE o.created_at >= ${THIS_MONTH_START}
     ORDER BY o.created_at DESC`,
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    ownerFullName: row.owner_full_name,
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : row.created_at.toISOString(),
  }));
}

export type RecentInspection = {
  id: string;
  plate: string | null;
  status: string;
  kind: string | null;
  createdAt: string;
  completedAt: string | null;
  orgId: string | null;
  orgName: string | null;
  inspectorFullName: string | null;
};

/** Últimos N peritajes cross-org (cualquier status) ordenados por updated_at. */
export async function getRecentActivity(limit = 10): Promise<RecentInspection[]> {
  const r = await query<{
    id: string;
    plate: string | null;
    status: string;
    kind: string | null;
    created_at: Date | string;
    completed_at: string | null;
    org_id: string | null;
    org_name: string | null;
    inspector_full_name: string | null;
  }>(
    `SELECT i.id,
            i.plate,
            i.status,
            i.data->>'kind' AS kind,
            i.created_at,
            i.data->>'completedAt' AS completed_at,
            i.org_id,
            o.name AS org_name,
            u.full_name AS inspector_full_name
     FROM inspections i
     LEFT JOIN organizations o ON o.id = i.org_id
     LEFT JOIN users u ON u.id = i.user_id
     ORDER BY i.updated_at DESC
     LIMIT $1`,
    [limit],
  );
  return r.rows.map((row) => ({
    id: row.id,
    plate: row.plate,
    status: row.status,
    kind: row.kind,
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : row.created_at.toISOString(),
    completedAt: row.completed_at ?? null,
    orgId: row.org_id,
    orgName: row.org_name,
    inspectorFullName: row.inspector_full_name,
  }));
}

/** Listado por org para el detalle (paginado simple por limit). */
export async function listRecentInspectionsForOrg(
  orgId: string,
  limit = 15,
): Promise<RecentInspection[]> {
  const r = await query<{
    id: string;
    plate: string | null;
    status: string;
    kind: string | null;
    created_at: Date | string;
    completed_at: string | null;
    inspector_full_name: string | null;
  }>(
    `SELECT i.id,
            i.plate,
            i.status,
            i.data->>'kind' AS kind,
            i.created_at,
            i.data->>'completedAt' AS completed_at,
            u.full_name AS inspector_full_name
     FROM inspections i
     LEFT JOIN users u ON u.id = i.user_id
     WHERE i.org_id = $1
     ORDER BY i.updated_at DESC
     LIMIT $2`,
    [orgId, limit],
  );
  return r.rows.map((row) => ({
    id: row.id,
    plate: row.plate,
    status: row.status,
    kind: row.kind,
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : row.created_at.toISOString(),
    completedAt: row.completed_at ?? null,
    orgId,
    orgName: null,
    inspectorFullName: row.inspector_full_name,
  }));
}
