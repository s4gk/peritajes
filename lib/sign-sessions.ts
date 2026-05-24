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

// TTL presencial: 10 min (QR mostrado en pantalla, el cliente escanea ya).
// TTL remoto: 72h (link enviado por WhatsApp, el cliente firma desde casa).
const SESSION_TTL_MS_PRESENTIAL = 10 * 60 * 1000;
const SESSION_TTL_MS_REMOTE = 72 * 60 * 60 * 1000;

export type SignSessionMode = "presential" | "remote";

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
  mode: SignSessionMode;
  inspectionId: string | null;
};

type Row = {
  token: string;
  context: SignSessionContext | null;
  signature: string | null;
  created_at: Date | string;
  expires_at: Date | string;
  signed_at: Date | string | null;
  mode: string | null;
  inspection_id: string | null;
};

function tsToMs(v: Date | string): number {
  return typeof v === "string" ? Date.parse(v) : v.getTime();
}

function rowToSession(row: Row): SignSession {
  const mode: SignSessionMode = row.mode === "remote" ? "remote" : "presential";
  return {
    token: row.token,
    context: row.context ?? {},
    signature: row.signature ?? undefined,
    createdAt: tsToMs(row.created_at),
    expiresAt: tsToMs(row.expires_at),
    signedAt: row.signed_at ? tsToMs(row.signed_at) : undefined,
    mode,
    inspectionId: row.inspection_id ?? null,
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
  options: { mode?: SignSessionMode; inspectionId?: string | null } = {},
): Promise<SignSession> {
  await pruneExpired();
  const token = makeToken();
  const mode: SignSessionMode = options.mode ?? "presential";
  const ttl =
    mode === "remote" ? SESSION_TTL_MS_REMOTE : SESSION_TTL_MS_PRESENTIAL;
  const expires = new Date(Date.now() + ttl);
  const r = await query<Row>(
    `INSERT INTO sign_sessions (token, context, expires_at, mode, inspection_id)
     VALUES ($1, $2::jsonb, $3, $4, $5)
     RETURNING *`,
    [
      token,
      JSON.stringify(context ?? {}),
      expires,
      mode,
      options.inspectionId ?? null,
    ],
  );
  return rowToSession(r.rows[0]);
}

/**
 * Devuelve la sesión REMOTA activa de un peritaje (si existe). Sirve al wizard
 * para saber si ya pidió firma remota y mostrar el estado ("esperando firma /
 * link envió hace Xh") sin ofrecer crear otra y duplicar. Una sesión cuenta
 * como activa mientras no esté firmada y no haya vencido.
 */
export async function getActiveRemoteSessionForInspection(
  inspectionId: string,
): Promise<SignSession | null> {
  const r = await query<Row>(
    `SELECT * FROM sign_sessions
     WHERE inspection_id = $1
       AND mode = 'remote'
       AND signed_at IS NULL
       AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [inspectionId],
  );
  if (r.rowCount === 0) return null;
  return rowToSession(r.rows[0]);
}

/**
 * Devuelve la última sesión REMOTA firmada (no expirada) del peritaje. Sirve
 * para mostrar al perito "firmado por X hace 5 min" antes de que el wizard
 * incorpore la firma al data del peritaje.
 */
export async function getSignedRemoteSessionForInspection(
  inspectionId: string,
): Promise<SignSession | null> {
  const r = await query<Row>(
    `SELECT * FROM sign_sessions
     WHERE inspection_id = $1
       AND mode = 'remote'
       AND signed_at IS NOT NULL
     ORDER BY signed_at DESC
     LIMIT 1`,
    [inspectionId],
  );
  if (r.rowCount === 0) return null;
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
