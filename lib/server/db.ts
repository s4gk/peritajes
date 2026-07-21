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
  __peritoOwnersBackfilled?: boolean;
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
ALTER TABLE users ADD COLUMN IF NOT EXISTS license_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_data_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_phone TEXT;
-- 2026-05: el rol operativo "perito" pasa a llamarse "owner" (dueño de
-- negocio). El admin sigue siendo el superuser técnico. Migramos las filas
-- existentes y rotamos el DEFAULT para nuevos usuarios.
UPDATE users SET role = 'owner' WHERE role = 'perito';
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'owner';

-- 2026-05: multi-tenancy. organizations representa al "cliente" de Vestel:
--   admin (Vestel)  → no pertenece a ninguna org (org_id NULL)
--   owner           → dueño del negocio, owner_user_id de SU org
--   employee        → perito asalariado, miembro de la org del owner
-- El parent_user_id en users es informativo (audit: quién creó al empleado).
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 2026-05: suspender empresa cliente sin borrar datos. active=false bloquea
-- el login de todos sus users (owner + employees) hasta que admin reactive.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
-- 2026-05: número remitente de WhatsApp por organización para el proveedor
-- Twilio (Modelo B multi-tenant). E.164 con + (ej: "+573001234567"). La cuenta
-- Twilio es global (env vars); solo el número From varía por org.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS twilio_wa_from TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

-- 2026-07: el email pasa a ser identificador de recuperación de contraseña
-- ("olvidé mi contraseña" busca por correo), así que necesita ser único e
-- insensible a mayúsculas/espacios. Sigue siendo NULLable por los usuarios
-- históricos que se crearon sin correo.
--
-- Se crea de forma defensiva: esta SQL corre en el arranque de CADA proceso,
-- así que si hubiera duplicados históricos un CREATE UNIQUE INDEX pelado
-- tumbaría la app entera al bootear. Preferimos avisar y seguir sin índice.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users
    WHERE email IS NOT NULL AND btrim(email) <> ''
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE WARNING 'users.email tiene duplicados: no se creo idx_users_email_unique. Resolvelos y reinicia el proceso.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
      ON users (lower(btrim(email)))
      WHERE email IS NOT NULL AND btrim(email) <> '';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
-- 2026-05: impersonate de admin. Cuando un admin entra como otro user, se
-- crea una sesión target con impersonated_by = adminId y original_session_id
-- apuntando a la sesión admin original (para restaurar al salir sin
-- re-loguear).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS impersonated_by TEXT
  REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS original_session_id TEXT;

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
-- 2026-05 fase 3 multi-tenant: cada org tiene su propia configuración.
-- Mantenemos la PK legacy id para no romper rows existentes; el lookup
-- nuevo es por org_id. La fila id=1 (seed inicial) queda como template
-- y se asocia al org default en backfill. Nuevas orgs reciben su fila al
-- crearse o al primer get.
ALTER TABLE company_config ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_config_org ON company_config(org_id) WHERE org_id IS NOT NULL;
-- El constraint CHECK (id = 1) era del diseño single-tenant original; con
-- multi-tenant cada org necesita su propia fila con id > 1. Lo dropamos si
-- todavía existe (idempotente: DO block verifica antes de alterar).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'company_config'
      AND constraint_name = 'company_config_id_check'
      AND constraint_type = 'CHECK'
  ) THEN
    ALTER TABLE company_config DROP CONSTRAINT company_config_id_check;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(org_id);

CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  plate TEXT,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS report_number TEXT;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS pdf_path TEXT;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS pdf_sha256 TEXT;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS pdf_size INTEGER;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspections_report_number ON inspections(report_number) WHERE report_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inspections_updated ON inspections(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_user ON inspections(user_id);
CREATE INDEX IF NOT EXISTS idx_inspections_org ON inspections(org_id);
CREATE INDEX IF NOT EXISTS idx_inspections_plate ON inspections(plate) WHERE plate IS NOT NULL;

CREATE TABLE IF NOT EXISTS report_counters (
  year INTEGER PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);
-- 2026-05 fase 3: cada org lleva su propio consecutivo de informes. El
-- DO block detecta si la migración ya corrió (existe la columna org_id) y
-- evita repetir. La fila legacy queda asignada al org default en backfill.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'report_counters' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE report_counters ADD COLUMN org_id TEXT;
    -- placeholder temporal — el backfill lo reemplaza con el org real
    UPDATE report_counters SET org_id = '__legacy__' WHERE org_id IS NULL;
    ALTER TABLE report_counters ALTER COLUMN org_id SET NOT NULL;
    ALTER TABLE report_counters DROP CONSTRAINT report_counters_pkey;
    ALTER TABLE report_counters ADD PRIMARY KEY (org_id, year);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  owner_name TEXT NOT NULL DEFAULT '',
  owner_phone TEXT NOT NULL DEFAULT '',
  owner_document TEXT NOT NULL DEFAULT '',
  plate TEXT NOT NULL DEFAULT '',
  vehicle_label TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  inspection_id TEXT REFERENCES inspections(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_assigned ON appointments(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminders_sent JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_org ON appointments(org_id);

CREATE TABLE IF NOT EXISTS verifik_cache (
  service TEXT NOT NULL,
  plate TEXT NOT NULL,
  doc_key TEXT NOT NULL DEFAULT '',
  response JSONB NOT NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (service, plate, doc_key)
);
CREATE INDEX IF NOT EXISTS idx_verifik_cache_at ON verifik_cache(cached_at);

CREATE TABLE IF NOT EXISTS vehicle_renders (
  cache_key TEXT PRIMARY KEY,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year TEXT NOT NULL,
  body_type TEXT,
  prompt TEXT NOT NULL,
  ai_model TEXT NOT NULL,
  image_b64 TEXT NOT NULL,
  mime TEXT NOT NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_renders_at ON vehicle_renders(cached_at);

CREATE TABLE IF NOT EXISTS share_tokens (
  token TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_share_tokens_inspection ON share_tokens(inspection_id);
CREATE INDEX IF NOT EXISTS idx_share_tokens_expires ON share_tokens(expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON password_reset_tokens(expires_at);

CREATE TABLE IF NOT EXISTS sign_sessions (
  token TEXT PRIMARY KEY,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  signed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sign_sessions_expires ON sign_sessions(expires_at);
-- Firma remota (cliente no presente): el perito pide un link de larga vida
-- (72h) por WhatsApp y el cliente firma desde la casa. mode distingue
-- presencial (TTL 10min, sesión via QR en pantalla) de remoto (TTL 72h, link
-- WA). inspection_id permite avisarle al perito por WA cuando el cliente
-- firma. Ambas columnas opcionales para no romper sesiones presenciales que
-- ya están vivas en el cluster.
ALTER TABLE sign_sessions ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'presential';
ALTER TABLE sign_sessions ADD COLUMN IF NOT EXISTS inspection_id TEXT REFERENCES inspections(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_sign_sessions_inspection ON sign_sessions(inspection_id);

-- Suscripciones Web Push. Un user puede tener varias (1 por device/browser).
-- El endpoint es único — si el mismo browser re-suscribe, el ON CONFLICT
-- actualiza las keys y last_used_at en vez de duplicar fila.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- Propietarios de vehículos (dueños que aparecen en peritajes / citas).
-- Scoped por org: la cartera de un cliente del SaaS NO se comparte con otro.
-- Dedup primario por (org_id, document); fallback por (org_id, phone) cuando
-- no hay document. inspections_count / *_seen_at se mantienen via UPSERT
-- desde el flujo de guardado de peritajes y creación de citas.
CREATE TABLE IF NOT EXISTS vehicle_owners (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  document TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  inspections_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
-- Dedup por documento dentro de la org (parcial: solo cuando hay documento).
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_owners_org_document
  ON vehicle_owners(org_id, document)
  WHERE document <> '';
-- Búsqueda por teléfono (segundaria) y por nombre (autocomplete).
CREATE INDEX IF NOT EXISTS idx_vehicle_owners_org_phone
  ON vehicle_owners(org_id, phone) WHERE phone <> '';
CREATE INDEX IF NOT EXISTS idx_vehicle_owners_org_name
  ON vehicle_owners(org_id, lower(full_name));
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
    await backfillOrganizations();
    globalScope.__peritoMigrationsApplied = true;
    // Backfill de vehicle_owners corre DESPUÉS de marcar migrations como
    // aplicadas para evitar deadlock: el helper usa query() que llama a
    // ensureMigrated. Si aún estuviéramos resolviendo la promise, await
    // sobre sí misma haría hang. Va fire-and-forget — si falla, el log
    // queda y el admin puede re-disparar el deploy.
    if (!globalScope.__peritoOwnersBackfilled) {
      globalScope.__peritoOwnersBackfilled = true;
      import("./vehicle-owners")
        .then((m) => m.backfillVehicleOwners())
        .then((res) =>
          console.log(
            `[migrations] backfill vehicle_owners: ${res.insertedOrUpdated} filas procesadas`,
          ),
        )
        .catch((err) => {
          console.error("[migrations] backfill vehicle_owners falló:", err);
          globalScope.__peritoOwnersBackfilled = false;
        });
    }
  })();
  await globalScope.__peritoMigrationsPromise;
}

/**
 * Backfill one-shot del modelo multi-tenant para deployments preexistentes:
 * detecta usuarios non-admin sin org_id y crea una org "default" con su
 * nombre tomado de `company_config.name`. Asigna a la org todos los datos
 * huérfanos (inspections, appointments, audit_log).
 *
 * Es idempotente: si no hay nada por backfillear (instalación nueva o ya
 * migrada), no hace nada. Si hay múltiples owners sin org_id (no debería
 * pasar nunca con el flujo histórico — siempre hubo 1 dueño), todos caen en
 * la misma org default y queda como trabajo manual del admin separarlos.
 */
async function backfillOrganizations(): Promise<void> {
  const orphaned = await rawQuery<{ id: string; role: string }>(
    `SELECT id, role FROM users
     WHERE role != 'admin' AND org_id IS NULL
     ORDER BY created_at ASC`,
  );
  if (orphaned.rowCount === 0) return;

  const company = await rawQuery<{ name: string }>(
    "SELECT name FROM company_config WHERE id = 1",
  );
  const orgName = company.rows[0]?.name?.trim() || "Peritaje";

  // Buscamos si ya existe una org con ese nombre — si la app crasheó a la
  // mitad del backfill en un deploy anterior, queremos reutilizar la fila
  // en lugar de crear duplicados.
  const existing = await rawQuery<{ id: string }>(
    "SELECT id FROM organizations WHERE name = $1 LIMIT 1",
    [orgName],
  );
  let orgId = existing.rows[0]?.id ?? null;
  if (!orgId) {
    orgId = `org_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    const firstOwner = orphaned.rows.find((u) => u.role === "owner")?.id ?? null;
    await rawQuery(
      `INSERT INTO organizations (id, name, owner_user_id)
       VALUES ($1, $2, $3)`,
      [orgId, orgName, firstOwner],
    );
    console.log(
      `[migrations] backfill: creada org "${orgName}" (${orgId}) con owner=${firstOwner ?? "ninguno"}`,
    );
  }

  // Asignamos todos los usuarios no-admin sin org a esta org.
  await rawQuery(
    `UPDATE users SET org_id = $1 WHERE org_id IS NULL AND role != 'admin'`,
    [orgId],
  );
  // Todas las inspections huérfanas (sin org) caen acá. Si en el futuro hay
  // varias orgs, esto no debería volver a correr porque las nuevas filas se
  // crean con org_id explícito.
  await rawQuery(`UPDATE inspections SET org_id = $1 WHERE org_id IS NULL`, [orgId]);
  await rawQuery(`UPDATE appointments SET org_id = $1 WHERE org_id IS NULL`, [orgId]);
  await rawQuery(`UPDATE audit_log SET org_id = $1 WHERE org_id IS NULL`, [orgId]);

  // company_config legacy (id=1, seed) pasa a ser la config de la org default.
  await rawQuery(
    `UPDATE company_config SET org_id = $1 WHERE id = 1 AND org_id IS NULL`,
    [orgId],
  );
  // report_counters legacy (org_id='__legacy__') pasa a la org default. Si
  // ya hay rows con el org_id real, los respetamos (idempotente).
  await rawQuery(
    `UPDATE report_counters SET org_id = $1 WHERE org_id = '__legacy__'`,
    [orgId],
  );
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
  } catch (err) {
    // Las fallas de auditoría no deben romper el request principal, pero antes
    // de este cambio se silenciaban totalmente — un atacante podía aprovechar
    // una DB caída para actuar sin quedar registrado y nadie se enteraba.
    // Loggeamos a stderr para que pm2/journald lo capturen.
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[audit] failed to record action="${action}" user=${userId ?? "anon"}: ${message}`,
    );
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
