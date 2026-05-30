import "server-only";

import { query } from "./db";

export type InspectorStat = {
  userId: string;
  fullName: string;
  role: string;
  thisMonth: number;
  lastMonth: number;
  completed: number;
  drafts: number;
  total: number;
  lastActiveAt: string | null;
};

export async function getInspectorStats(orgId: string): Promise<InspectorStat[]> {
  const r = await query<{
    user_id: string;
    full_name: string;
    role: string;
    this_month: string;
    last_month: string;
    completed: string;
    drafts: string;
    total: string;
    last_active_at: Date | null;
  }>(
    `SELECT
       u.id                                                              AS user_id,
       u.full_name,
       u.role,
       COUNT(i.id) FILTER (
         WHERE i.created_at >= date_trunc('month', now())
       )::int                                                            AS this_month,
       COUNT(i.id) FILTER (
         WHERE i.created_at >= date_trunc('month', now()) - interval '1 month'
           AND i.created_at <  date_trunc('month', now())
       )::int                                                            AS last_month,
       COUNT(i.id) FILTER (WHERE i.status = 'completed')::int           AS completed,
       COUNT(i.id) FILTER (WHERE i.status = 'draft')::int               AS drafts,
       COUNT(i.id)::int                                                  AS total,
       MAX(i.updated_at)                                                 AS last_active_at
     FROM users u
     LEFT JOIN inspections i ON i.user_id = u.id
     WHERE u.org_id = $1
       AND u.role IN ('owner', 'employee')
       AND u.active = TRUE
     GROUP BY u.id, u.full_name, u.role
     ORDER BY this_month DESC, total DESC`,
    [orgId],
  );

  return r.rows.map((row) => ({
    userId: row.user_id,
    fullName: row.full_name,
    role: row.role,
    thisMonth: Number(row.this_month),
    lastMonth: Number(row.last_month),
    completed: Number(row.completed),
    drafts: Number(row.drafts),
    total: Number(row.total),
    lastActiveAt: row.last_active_at ? row.last_active_at.toISOString() : null,
  }));
}
