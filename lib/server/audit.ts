import "server-only";

import { query } from "./db";

/**
 * Lectura del audit log. La escritura está en db.ts (logAudit). Acá sólo
 * exponemos consultas para la UI admin.
 */

export type AuditEntry = {
  id: string;
  userId: string | null;
  username: string | null;
  fullName: string | null;
  action: string;
  detail: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  user_id: string | null;
  username: string | null;
  full_name: string | null;
  action: string;
  detail: string | null;
  created_at: Date | string;
};

function tsToISO(v: Date | string): string {
  return typeof v === "string" ? v : v.toISOString();
}

function rowToEntry(row: Row): AuditEntry {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    fullName: row.full_name,
    action: row.action,
    detail: row.detail,
    createdAt: tsToISO(row.created_at),
  };
}

export type AuditFilter = {
  userId?: string | null;
  /** Filtro por acción exacta o por prefijo si termina en `.*` (ej. "user.*"). */
  action?: string | null;
  /** ISO date (YYYY-MM-DD) inclusivo. */
  from?: string | null;
  /** ISO date (YYYY-MM-DD) inclusivo. */
  to?: string | null;
  limit?: number;
  /** Cursor: id del último row visto (paginamos por id descendente). */
  before?: string | null;
};

export type AuditPage = {
  entries: AuditEntry[];
  /** id del último entry — útil como cursor para la siguiente página. */
  nextCursor: string | null;
};

export async function listAuditLog(filter: AuditFilter): Promise<AuditPage> {
  const wheres: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (filter.userId) {
    wheres.push(`a.user_id = $${i++}`);
    params.push(filter.userId);
  }
  if (filter.action) {
    if (filter.action.endsWith(".*")) {
      wheres.push(`a.action LIKE $${i++}`);
      params.push(`${filter.action.slice(0, -2)}.%`);
    } else {
      wheres.push(`a.action = $${i++}`);
      params.push(filter.action);
    }
  }
  if (filter.from) {
    wheres.push(`a.created_at >= $${i++}::date`);
    params.push(filter.from);
  }
  if (filter.to) {
    // Inclusivo: sumamos un día y comparamos con <.
    wheres.push(`a.created_at < ($${i++}::date + INTERVAL '1 day')`);
    params.push(filter.to);
  }
  if (filter.before) {
    wheres.push(`a.id < $${i++}::bigint`);
    params.push(filter.before);
  }

  const limit = Math.min(500, Math.max(10, filter.limit ?? 100));
  params.push(limit);

  const r = await query<Row>(
    `SELECT a.id::text AS id, a.user_id, a.action, a.detail, a.created_at,
            u.username, u.full_name
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     ${wheres.length > 0 ? "WHERE " + wheres.join(" AND ") : ""}
     ORDER BY a.id DESC
     LIMIT $${i}`,
    params,
  );
  const entries = r.rows.map(rowToEntry);
  const nextCursor = entries.length === limit ? entries[entries.length - 1].id : null;
  return { entries, nextCursor };
}

/**
 * Lista las acciones distintas presentes en el log — para llenar el dropdown
 * de filtro. Cacheo no necesario: la tabla nunca crece tanto como para que un
 * SELECT DISTINCT pese.
 */
export async function listAuditActions(): Promise<string[]> {
  const r = await query<{ action: string }>(
    `SELECT DISTINCT action FROM audit_log ORDER BY action ASC LIMIT 200`,
  );
  return r.rows.map((row) => row.action);
}
