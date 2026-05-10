import "server-only";

import { randomBytes } from "node:crypto";

import { query } from "./db";

/**
 * Persistent share tokens that let a perito hand a public link to their client.
 * The token is opaque (128 bits of entropy) and resolves to an inspection_id.
 * The cliente abre /r/[token] y baja el PDF sin necesidad de loguearse.
 *
 * Reglas:
 *   - TTL por defecto 90 días desde creación.
 *   - Se puede revocar manualmente (revoked_at IS NOT NULL).
 *   - Cada acceso público incrementa access_count y actualiza last_accessed_at.
 */

export type ShareToken = {
  token: string;
  inspectionId: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
};

const DEFAULT_TTL_DAYS = 90;

function rowToToken(row: Record<string, unknown>): ShareToken {
  return {
    token: row.token as string,
    inspectionId: row.inspection_id as string,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    expiresAt: (row.expires_at as Date).toISOString(),
    revokedAt: row.revoked_at ? (row.revoked_at as Date).toISOString() : null,
    lastAccessedAt: row.last_accessed_at ? (row.last_accessed_at as Date).toISOString() : null,
    accessCount: row.access_count as number,
  };
}

function makeToken(): string {
  // 128 bits → 22-char base64url. Usamos directamente Node's crypto.randomBytes
  // — sin fallback a Math.random(): un fallback inseguro silencioso es peor
  // que romper, porque acá se filtran datos personales del peritaje.
  return randomBytes(16).toString("base64url");
}

export async function createShareToken(opts: {
  inspectionId: string;
  createdBy: string | null;
  ttlDays?: number;
}): Promise<ShareToken> {
  const ttlDays = opts.ttlDays ?? DEFAULT_TTL_DAYS;
  const expires = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const token = makeToken();
  const res = await query(
    `INSERT INTO share_tokens (token, inspection_id, created_by, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [token, opts.inspectionId, opts.createdBy, expires],
  );
  return rowToToken(res.rows[0] as unknown as Record<string, unknown>);
}

export async function getShareToken(token: string): Promise<ShareToken | null> {
  const res = await query(`SELECT * FROM share_tokens WHERE token = $1`, [token]);
  if (res.rowCount === 0) return null;
  return rowToToken(res.rows[0] as unknown as Record<string, unknown>);
}

/** Returns the active token for an inspection (most recent non-revoked, non-expired) or null. */
export async function getActiveShareTokenForInspection(
  inspectionId: string,
): Promise<ShareToken | null> {
  const res = await query(
    `SELECT * FROM share_tokens
     WHERE inspection_id = $1
       AND revoked_at IS NULL
       AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [inspectionId],
  );
  if (res.rowCount === 0) return null;
  return rowToToken(res.rows[0] as unknown as Record<string, unknown>);
}

export async function revokeShareToken(token: string): Promise<void> {
  await query(
    `UPDATE share_tokens SET revoked_at = now() WHERE token = $1 AND revoked_at IS NULL`,
    [token],
  );
}

export async function touchShareTokenAccess(token: string): Promise<void> {
  await query(
    `UPDATE share_tokens
     SET last_accessed_at = now(), access_count = access_count + 1
     WHERE token = $1`,
    [token],
  );
}

export function isShareTokenLive(t: ShareToken): boolean {
  if (t.revokedAt) return false;
  return new Date(t.expiresAt).getTime() > Date.now();
}
