import "server-only";

import { Pool, type QueryResult, type QueryResultRow } from "pg";

/**
 * Postgres pool singleton. The DATABASE_URL env var is required at runtime.
 * Migrations are idempotent SQL run once per process via `ensureMigrated()`.
 */

const globalScope = globalThis as unknown as {
  __peritoPgPool?: Pool;
  __peritoMigrationsApplied?: boolean;
  __peritoMigrationsPromise?: Promise<void>;
};

function buildPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL no está configurado. Agrégalo en .env.local con la cadena de conexión a Postgres.",
    );
  }
  return new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

export function getPool(): Pool {
  if (!globalScope.__peritoPgPool) {
    globalScope.__peritoPgPool = buildPool();
  }
  return globalScope.__peritoPgPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  await ensureMigrated();
  return getPool().query<T>(text, params as unknown[] | undefined);
}

/**
 * Direct query without auto-migration — used inside the migration runner so we
 * don't recurse.
 */
async function rawQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as unknown[] | undefined);
}

const MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'perito',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS company_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  tagline TEXT,
  nit TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  logo_data_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  plate TEXT,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inspections_updated ON inspections(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_user ON inspections(user_id);
CREATE INDEX IF NOT EXISTS idx_inspections_plate ON inspections(plate) WHERE plate IS NOT NULL;
`;

async function ensureMigrated(): Promise<void> {
  if (globalScope.__peritoMigrationsApplied) return;
  if (globalScope.__peritoMigrationsPromise) {
    await globalScope.__peritoMigrationsPromise;
    return;
  }
  globalScope.__peritoMigrationsPromise = (async () => {
    await rawQuery(MIGRATIONS_SQL);
    // Seed the company_config singleton row so updates always have a target.
    await rawQuery(
      `INSERT INTO company_config (id, name, tagline, nit, address, phone, email, website, logo_data_url, updated_at)
       VALUES (1, $1, $2, '', $3, '', '', '', '', now())
       ON CONFLICT (id) DO NOTHING`,
      [
        "Peritaje del Llano",
        "Peritaje vehicular profesional",
        "Colombia",
      ],
    );
    globalScope.__peritoMigrationsApplied = true;
  })();
  await globalScope.__peritoMigrationsPromise;
}

export async function logAudit(
  userId: string | null,
  action: string,
  detail?: string,
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log (user_id, action, detail) VALUES ($1, $2, $3)`,
      [userId, action, detail ?? null],
    );
  } catch {
    // Audit failures must not break the request.
  }
}

/**
 * Test/CLI helper: drop migration cache so the next query re-runs migrations.
 * Not used in normal app flow.
 */
export function _resetMigrationCacheForTests() {
  globalScope.__peritoMigrationsApplied = false;
  globalScope.__peritoMigrationsPromise = undefined;
}
