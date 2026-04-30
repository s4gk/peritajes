import "server-only";

import { query } from "./db";
import type { FasecoldaResponse, RuntResponse } from "@/lib/verifik/types";

/**
 * Cache de respuestas crudas de Verifik en Postgres.
 *
 * Por qué cachear:
 *  - Verifik cobra por call (FASECOLDA $0.40, RUNT separado). Cualquier
 *    re-consulta de la misma placa quema crédito para nada.
 *  - Si el mapping en código falla (por un cambio de shape, un tipo nuevo,
 *    bug del adapter), el response crudo queda guardado y podemos arreglar
 *    el código sin volver a pagar la call.
 *
 * Llave: (service, plate, doc_key). Para FASECOLDA solo importa plate
 * (doc_key=''). Para RUNT incluye tipoDocumento+numero porque RUNT exige
 * coincidencia con el dueño registrado.
 *
 * TTL: configurable via VERIFIK_CACHE_TTL_HOURS. Default 168h (7 días) —
 * bajo para testing, hay que bajarlo a 24h en prod si se usan datos como
 * SOAT/tecnomecánica que cambian frecuentemente.
 */

export type VerifikService = "fasecolda" | "runt";

const DEFAULT_TTL_HOURS = 168; // 7 días

function ttlMs(): number {
  const raw = process.env.VERIFIK_CACHE_TTL_HOURS;
  const hours = raw ? Number(raw) : DEFAULT_TTL_HOURS;
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_TTL_HOURS * 3_600_000;
  return hours * 3_600_000;
}

export function buildDocKey(
  service: VerifikService,
  documentType?: string,
  documentNumber?: string,
): string {
  if (service === "fasecolda") return "";
  return `${(documentType ?? "").trim().toUpperCase()}:${(documentNumber ?? "").trim()}`;
}

type CacheRow<T> = {
  response: T;
  cached_at: Date | string;
};

function cachedAtMs(row: CacheRow<unknown>): number {
  return typeof row.cached_at === "string"
    ? Date.parse(row.cached_at)
    : row.cached_at.getTime();
}

export type CacheGetResult<T> =
  | { hit: true; response: T; cachedAt: string }
  | { hit: false };

async function get<T>(
  service: VerifikService,
  plate: string,
  docKey: string,
): Promise<CacheGetResult<T>> {
  try {
    const r = await query<CacheRow<T>>(
      `SELECT response, cached_at
       FROM verifik_cache
       WHERE service = $1 AND plate = $2 AND doc_key = $3`,
      [service, plate.trim().toUpperCase(), docKey],
    );
    const row = r.rows[0];
    if (!row) return { hit: false };
    if (Date.now() - cachedAtMs(row) > ttlMs()) {
      return { hit: false };
    }
    const cachedAt =
      typeof row.cached_at === "string"
        ? row.cached_at
        : row.cached_at.toISOString();
    return { hit: true, response: row.response, cachedAt };
  } catch {
    // Cache failures must never break the lookup. Just miss.
    return { hit: false };
  }
}

async function put<T>(
  service: VerifikService,
  plate: string,
  docKey: string,
  response: T,
): Promise<void> {
  try {
    await query(
      `INSERT INTO verifik_cache (service, plate, doc_key, response, cached_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (service, plate, doc_key)
       DO UPDATE SET response = EXCLUDED.response, cached_at = now()`,
      [service, plate.trim().toUpperCase(), docKey, JSON.stringify(response)],
    );
  } catch {
    // Same: cache write failures are silent.
  }
}

export async function getFasecoldaCache(
  plate: string,
): Promise<CacheGetResult<FasecoldaResponse>> {
  return get<FasecoldaResponse>("fasecolda", plate, "");
}

export async function putFasecoldaCache(
  plate: string,
  response: FasecoldaResponse,
): Promise<void> {
  return put("fasecolda", plate, "", response);
}

export async function getRuntCache(
  plate: string,
  documentType: string,
  documentNumber: string,
): Promise<CacheGetResult<RuntResponse>> {
  return get<RuntResponse>(
    "runt",
    plate,
    buildDocKey("runt", documentType, documentNumber),
  );
}

export async function putRuntCache(
  plate: string,
  documentType: string,
  documentNumber: string,
  response: RuntResponse,
): Promise<void> {
  return put(
    "runt",
    plate,
    buildDocKey("runt", documentType, documentNumber),
    response,
  );
}

/**
 * Periodic cleanup of expired entries. Cheap to call on every request — the
 * delete is fast and skipped if there's nothing to prune.
 */
let lastSweepAt = 0;
export async function sweepExpired(): Promise<void> {
  const now = Date.now();
  if (now - lastSweepAt < 60 * 60 * 1000) return; // hourly at most
  lastSweepAt = now;
  try {
    const cutoff = new Date(now - ttlMs()).toISOString();
    await query("DELETE FROM verifik_cache WHERE cached_at < $1", [cutoff]);
  } catch {
    // ignore
  }
}

export type CacheStats = {
  total: number;
  fasecolda: number;
  runt: number;
};

export async function cacheStats(): Promise<CacheStats> {
  const r = await query<{ service: string; c: string }>(
    "SELECT service, COUNT(*)::text AS c FROM verifik_cache GROUP BY service",
  );
  const stats: CacheStats = { total: 0, fasecolda: 0, runt: 0 };
  for (const row of r.rows) {
    const n = Number(row.c);
    if (row.service === "fasecolda") stats.fasecolda = n;
    if (row.service === "runt") stats.runt = n;
    stats.total += n;
  }
  return stats;
}
