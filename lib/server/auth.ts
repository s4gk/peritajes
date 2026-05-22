import "server-only";

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

import { logAudit, query } from "./db";

export const SESSION_COOKIE = "perito_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/**
 * Roles de la app:
 *  - admin: superuser técnico (Vestel/desarrollo). Único que puede borrar
 *    peritajes finalizados y acceder a auditoría.
 *  - owner: dueño del negocio. Hace peritajes, configura su empresa y
 *    administra usuarios. Es el rol "operativo" que reemplaza al antiguo
 *    "perito" — filas legacy con role='perito' se mapean a 'owner' al leer.
 */
export type UserRole = "admin" | "owner";

export type User = {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  licenseId: string | null;
  /** Firma del perito guardada en perfil. Se inyecta en cada peritaje nuevo
   *  como default — el perito puede sobreescribirla per-inspección. */
  signatureDataUrl: string | null;
  /** Número de WhatsApp para recibir notificaciones internas (intake nuevo,
   *  firma completada). Formato libre — se normaliza al enviar. */
  waPhone: string | null;
  role: UserRole;
  /** Organización (tenant) a la que pertenece el usuario.
   *  - admin       → null
   *  - owner       → org propia (es `owner_user_id` de esa org)
   *  - employee    → org del owner que lo dio de alta */
  orgId: string | null;
  /** Quién creó este usuario (típicamente el owner que dio de alta a un
   *  employee). Informativo, audit-friendly — la autorización NO depende de
   *  este campo, sino de `orgId` + `role`. */
  parentUserId: string | null;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  full_name: string;
  email: string | null;
  license_id: string | null;
  signature_data_url: string | null;
  wa_phone: string | null;
  role: string;
  org_id: string | null;
  parent_user_id: string | null;
  active: boolean;
  created_at: Date | string;
  last_login_at: Date | string | null;
};

function tsToISO(v: Date | string | null): string | null {
  if (v === null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    email: row.email,
    licenseId: row.license_id ?? null,
    signatureDataUrl: row.signature_data_url ?? null,
    waPhone: row.wa_phone ?? null,
    role: row.role === "admin" ? "admin" : "owner",
    orgId: row.org_id ?? null,
    parentUserId: row.parent_user_id ?? null,
    active: row.active,
    createdAt: tsToISO(row.created_at) ?? "",
    lastLoginAt: tsToISO(row.last_login_at),
  };
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function makeId(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export async function countUsers(): Promise<number> {
  const r = await query<{ c: string }>("SELECT COUNT(*)::text AS c FROM users");
  return Number(r.rows[0].c);
}

export async function listUsers(): Promise<User[]> {
  const r = await query<UserRow>(
    "SELECT * FROM users ORDER BY created_at ASC",
  );
  return r.rows.map(rowToUser);
}

/**
 * Lista de teléfonos WhatsApp del equipo activo. Usado para fan-out de
 * notificaciones internas (intake nuevo, firma completada). Devuelve solo
 * usuarios activos con `wa_phone` configurado.
 */
export async function listTeamWhatsAppPhones(): Promise<
  Array<{ id: string; fullName: string; waPhone: string }>
> {
  const r = await query<{ id: string; full_name: string; wa_phone: string }>(
    `SELECT id, full_name, wa_phone
     FROM users
     WHERE active = TRUE AND wa_phone IS NOT NULL AND wa_phone <> ''`,
  );
  return r.rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    waPhone: row.wa_phone,
  }));
}

export async function getUserByUsername(
  username: string,
): Promise<UserRow | null> {
  const r = await query<UserRow>(
    "SELECT * FROM users WHERE username = $1",
    [username.trim().toLowerCase()],
  );
  return r.rows[0] ?? null;
}

export async function getUserById(id: string): Promise<User | null> {
  const r = await query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
  const row = r.rows[0];
  return row ? rowToUser(row) : null;
}

export type CreateUserInput = {
  username: string;
  password: string;
  fullName: string;
  email?: string | null;
  role?: UserRole;
};

export async function createUser(input: CreateUserInput): Promise<User> {
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error(
      "El usuario debe tener 3-32 caracteres (letras, números, . _ -).",
    );
  }
  if (!input.password || input.password.length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres.");
  }
  if (!input.fullName.trim()) {
    throw new Error("El nombre completo es requerido.");
  }

  const existing = await getUserByUsername(username);
  if (existing) {
    throw new Error("Ese usuario ya existe.");
  }

  const id = makeId();
  const hash = await hashPassword(input.password);

  await query(
    `INSERT INTO users (id, username, password_hash, full_name, email, role, active)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
    [
      id,
      username,
      hash,
      input.fullName.trim(),
      input.email?.trim() || null,
      input.role ?? "owner",
    ],
  );

  const created = await getUserById(id);
  if (!created) throw new Error("No se pudo crear el usuario.");
  await logAudit(id, "user.created", JSON.stringify({ username, role: input.role }));
  return created;
}

export async function setUserActive(id: string, active: boolean): Promise<void> {
  await query("UPDATE users SET active = $1 WHERE id = $2", [active, id]);
}

export async function setUserPassword(
  id: string,
  password: string,
): Promise<void> {
  if (!password || password.length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres.");
  }
  const hash = await hashPassword(password);
  await query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, id]);
  await query("DELETE FROM sessions WHERE user_id = $1", [id]);
  await logAudit(id, "user.password_changed");
}

export type ProfileUpdate = {
  fullName?: string;
  email?: string | null;
  licenseId?: string | null;
  /** Pasar `null` borra la firma guardada. Cap a 1MB de base64 — más que eso
   *  rebotamos para no atragantar el INSERT con un PNG enorme. */
  signatureDataUrl?: string | null;
  /** Teléfono WhatsApp del miembro del equipo. Se valida flexible (dígitos +
   *  símbolos comunes) — la normalización a JID se hace al enviar. */
  waPhone?: string | null;
};

const SIGNATURE_MAX_BYTES = 1024 * 1024;

export async function updateUserProfile(
  id: string,
  patch: ProfileUpdate,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (patch.fullName !== undefined) {
    const trimmed = patch.fullName.trim();
    if (!trimmed) throw new Error("El nombre completo es requerido.");
    sets.push(`full_name = $${i++}`);
    params.push(trimmed);
  }
  if (patch.email !== undefined) {
    sets.push(`email = $${i++}`);
    params.push(patch.email?.trim() || null);
  }
  if (patch.licenseId !== undefined) {
    sets.push(`license_id = $${i++}`);
    params.push(patch.licenseId?.trim() || null);
  }
  if (patch.signatureDataUrl !== undefined) {
    const sig = patch.signatureDataUrl;
    if (sig === null || sig === "") {
      sets.push(`signature_data_url = $${i++}`);
      params.push(null);
    } else {
      if (typeof sig !== "string" || !sig.startsWith("data:image/")) {
        throw new Error("La firma debe ser una imagen válida.");
      }
      if (sig.length > SIGNATURE_MAX_BYTES) {
        throw new Error("La firma excede el tamaño máximo (1 MB).");
      }
      sets.push(`signature_data_url = $${i++}`);
      params.push(sig);
    }
  }
  if (patch.waPhone !== undefined) {
    const raw = patch.waPhone?.trim() || null;
    if (raw) {
      const digits = raw.replace(/\D/g, "");
      if (digits.length < 10) {
        throw new Error("El teléfono de WhatsApp debe tener al menos 10 dígitos.");
      }
    }
    sets.push(`wa_phone = $${i++}`);
    params.push(raw);
  }
  if (sets.length === 0) return;

  params.push(id);
  await query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${i}`, params);
  await logAudit(id, "user.profile_updated");
}

export async function deleteUser(id: string): Promise<void> {
  await query("DELETE FROM users WHERE id = $1", [id]);
  await logAudit(null, "user.deleted", id);
}

/* -----------------------------------------------------------
 *  Sessions
 * --------------------------------------------------------- */

export async function createSession(
  userId: string,
  userAgent?: string,
): Promise<string> {
  const id = makeId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await query(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent)
     VALUES ($1, $2, $3, $4)`,
    [id, userId, expiresAt, userAgent ?? null],
  );
  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
  return id;
}

export async function destroySession(sessionId: string): Promise<void> {
  await query("DELETE FROM sessions WHERE id = $1", [sessionId]);
}

export async function destroyExpiredSessions(): Promise<void> {
  await query("DELETE FROM sessions WHERE expires_at < now()");
}

export async function getSessionUser(sessionId: string): Promise<User | null> {
  const r = await query<UserRow & { s_expires_at: Date | string }>(
    `SELECT u.*, s.expires_at AS s_expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND u.active = TRUE`,
    [sessionId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const expiresAt = typeof row.s_expires_at === "string"
    ? Date.parse(row.s_expires_at)
    : row.s_expires_at.getTime();
  if (expiresAt < Date.now()) {
    await destroySession(sessionId);
    return null;
  }
  return rowToUser(row);
}

/* -----------------------------------------------------------
 *  Cookie helpers (Next.js server context)
 * --------------------------------------------------------- */

/**
 * Por defecto en producción marcamos la cookie como Secure (sólo HTTPS). Si el
 * deploy corre detrás de un proxy que termina TLS y el browser igual la ve por
 * HTTPS, esto es lo correcto. Si por alguna razón se necesita correr en HTTP
 * plano (lo cual NO se debería hacer en prod), poner COOKIE_INSECURE=true.
 *
 * En dev (NODE_ENV !== "production") seguimos en false para que el flujo HTTP
 * local no rompa el login.
 */
function shouldMarkCookieSecure(): boolean {
  if (process.env.COOKIE_INSECURE === "true") return false;
  if (process.env.COOKIE_SECURE === "true") return true;
  return process.env.NODE_ENV === "production";
}

export function setSessionCookie(sessionId: string) {
  cookies().set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldMarkCookieSecure(),
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie() {
  cookies().set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldMarkCookieSecure(),
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentUser(): Promise<User | null> {
  const sid = cookies().get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  return getSessionUser(sid);
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new Error("FORBIDDEN");
  }
  return user;
}
