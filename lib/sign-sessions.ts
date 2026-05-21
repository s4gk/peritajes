import "server-only";

/**
 * Persistencia de sesiones de firma cliente vía QR.
 *
 * Antes este módulo guardaba todo en `Map<string, SignSession>` en memoria —
 * fácil pero se perdía al reiniciar pm2. Si el perito mostraba el QR y el
 * server reiniciaba antes de que el cliente firmara, la sesión moría sin
 * señal y el cliente recibía 404.
 *
 * Ahora vive en Postgres (tabla `sign_sessions`). Cada sesión tiene:
 *   - token (PK, 128 bits base64url)
 *   - context (JSONB con datos del vehículo para mostrar al firmante)
 *   - signature (data URL, NULL hasta que firma)
 *   - expires_at (10 min por defecto, +60s al recibir firma)
 *
 * Sigue siendo single-tenant chico (no esperamos millones de sesiones), pero
 * ahora es resiliente a reinicios y multi-instancia futura.
 */

import { randomBytes } from "node:crypto";

import { query } from "./server/db";

const SESSION_TTL_MS = 10 * 60 * 1000;

export type SignSessionContext = {
  plate?: string;
  make?: string;
  model?: string;
  year?: string;
  inspector?: string;
  owner?: string;
};

export type SignSession = {
  token: string;
  context: SignSessionContext;
  signature?: string;
  createdAt: number;
  expiresAt: number;
  signedAt?: number;
};

type Row = {
  token: string;
  context: SignSessionContext | null;
  signature: string | null;
  created_at: Date | string;
  expires_at: Date | string;
  signed_at: Date | string | null;
};

function tsToMs(v: Date | string): number {
  return typeof v === "string" ? Date.parse(v) : v.getTime();
}

function rowToSession(row: Row): SignSession {
  return {
    token: row.token,
    context: row.context ?? {},
    signature: row.signature ?? undefined,
    createdAt: tsToMs(row.created_at),
    expiresAt: tsToMs(row.expires_at),
    signedAt: row.signed_at ? tsToMs(row.signed_at) : undefined,
  };
}

function makeToken(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Limpieza oportunista: barre filas vencidas. Se llama desde los flujos
 * principales para que no haga falta un cron aparte. Costo bajo (índice por
 * expires_at) y solo corre cuando llega un request.
 */
async function pruneExpired(): Promise<void> {
  try {
    await query("DELETE FROM sign_sessions WHERE expires_at < now()");
  } catch {
    /* la limpieza no debe romper el flow principal */
  }
}

export async function createSession(
  context: SignSessionContext,
): Promise<SignSession> {
  await pruneExpired();
  const token = makeToken();
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  const r = await query<Row>(
    `INSERT INTO sign_sessions (token, context, expires_at)
     VALUES ($1, $2::jsonb, $3)
     RETURNING *`,
    [token, JSON.stringify(context ?? {}), expires],
  );
  return rowToSession(r.rows[0]);
}

export async function getSession(token: string): Promise<SignSession | null> {
  const r = await query<Row>(
    `SELECT * FROM sign_sessions
     WHERE token = $1 AND expires_at > now()`,
    [token],
  );
  if (r.rowCount === 0) return null;
  return rowToSession(r.rows[0]);
}

export async function submitSignature(
  token: string,
  signature: string,
): Promise<SignSession | null> {
  // Extendemos el TTL al recibir la firma para darle al perito ~60s extra para
  // pollear y traerse la firma, aunque la sesión hubiera estado por vencer.
  const newExpires = new Date(Date.now() + 60_000);
  const r = await query<Row>(
    `UPDATE sign_sessions
     SET signature = $2,
         signed_at = now(),
         expires_at = GREATEST(expires_at, $3)
     WHERE token = $1 AND expires_at > now()
     RETURNING *`,
    [token, signature, newExpires],
  );
  if (r.rowCount === 0) return null;
  return rowToSession(r.rows[0]);
}

export async function deleteSession(token: string): Promise<void> {
  await query("DELETE FROM sign_sessions WHERE token = $1", [token]);
}
