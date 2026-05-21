import "server-only";

import crypto from "node:crypto";

import { hashPassword, type User } from "./auth";
import { logAudit, query } from "./db";

/**
 * Reset de contraseña vía link generado por admin. No usamos email — el admin
 * copia el link y lo manda por el canal que prefiera (WhatsApp, presencial,
 * etc.). El usuario abre el link, fija una contraseña nueva y se cierra el
 * resto de sesiones activas.
 *
 * Cada token es one-shot (used_at se setea cuando se consume) y vence en 24h.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type ResetTokenInfo = {
  token: string;
  userId: string;
  fullName: string;
  username: string;
  expiresAt: string;
};

type Row = {
  token: string;
  user_id: string;
  expires_at: Date | string;
  used_at: Date | string | null;
  full_name: string;
  username: string;
};

function tsToISO(v: Date | string): string {
  return typeof v === "string" ? v : v.toISOString();
}

function tsMs(v: Date | string): number {
  return typeof v === "string" ? Date.parse(v) : v.getTime();
}

function makeToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Crea un token de reset para el usuario indicado. Antes invalidamos cualquier
 * token vigente previo (no expirado, no usado) — un solo link "activo" por
 * usuario, así si el admin lo re-genera el anterior deja de funcionar.
 */
export async function createResetToken(
  userId: string,
  adminId: string | null,
): Promise<ResetTokenInfo> {
  // Sanity check: el user existe y está activo.
  const userR = await query<{ full_name: string; username: string; active: boolean }>(
    "SELECT full_name, username, active FROM users WHERE id = $1",
    [userId],
  );
  if (userR.rowCount === 0) throw new Error("Usuario no encontrado.");
  if (!userR.rows[0].active) {
    throw new Error("El usuario está inactivo. Activalo antes de generar un reset.");
  }

  // Invalidar tokens vigentes previos.
  await query(
    `UPDATE password_reset_tokens
     SET used_at = now()
     WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()`,
    [userId],
  );

  const token = makeToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await query(
    `INSERT INTO password_reset_tokens (token, user_id, expires_at, created_by)
     VALUES ($1, $2, $3, $4)`,
    [token, userId, expiresAt.toISOString(), adminId],
  );
  await logAudit(adminId, "user.reset_link_generated", userId);

  return {
    token,
    userId,
    fullName: userR.rows[0].full_name,
    username: userR.rows[0].username,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Devuelve los datos del token si todavía es válido (no vencido, no usado).
 * No revela el motivo del rechazo más allá de null — la página pública muestra
 * un mensaje genérico.
 */
export async function getLiveResetToken(token: string): Promise<{
  userId: string;
  fullName: string;
  username: string;
} | null> {
  const r = await query<Row>(
    `SELECT t.token, t.user_id, t.expires_at, t.used_at,
            u.full_name, u.username
     FROM password_reset_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token = $1 AND u.active = TRUE`,
    [token],
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  if (row.used_at !== null) return null;
  if (tsMs(row.expires_at) < Date.now()) return null;
  return {
    userId: row.user_id,
    fullName: row.full_name,
    username: row.username,
  };
}

/**
 * Consume el token y fija una nueva contraseña. Cierra todas las sesiones
 * activas del usuario (forzando re-login con la clave nueva). El UPDATE del
 * token con CTE garantiza one-shot: si dos requests llegan a la vez, solo uno
 * encuentra used_at IS NULL y obtiene el user_id.
 */
export async function consumeResetToken(
  token: string,
  newPassword: string,
): Promise<{ user: Pick<User, "id" | "username" | "fullName"> } | null> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres.");
  }

  const claim = await query<{ user_id: string }>(
    `UPDATE password_reset_tokens
     SET used_at = now()
     WHERE token = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [token],
  );
  if (claim.rowCount === 0) return null;

  const userId = claim.rows[0].user_id;
  const hash = await hashPassword(newPassword);
  await query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, userId]);
  await query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  await logAudit(userId, "user.password_reset_consumed");

  const userR = await query<{ id: string; username: string; full_name: string }>(
    "SELECT id, username, full_name FROM users WHERE id = $1",
    [userId],
  );
  const u = userR.rows[0];
  return {
    user: { id: u.id, username: u.username, fullName: u.full_name },
  };
}

/**
 * Limpieza periódica (puede llamarse desde un cron, pero por ahora la dejamos
 * disponible para uso manual desde /backup u otro).
 */
export async function pruneExpiredResetTokens(): Promise<number> {
  const r = await query(
    "DELETE FROM password_reset_tokens WHERE expires_at < now() - INTERVAL '7 days'",
  );
  return r.rowCount ?? 0;
}
