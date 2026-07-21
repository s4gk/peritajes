import "server-only";

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

import { logAudit, query } from "./db";

export const SESSION_COOKIE = "perito_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/**
 * Roles de la app (jerarquía multi-tenant):
 *  - admin: superuser técnico (Vestel). No pertenece a ninguna org. Ve y
 *    administra TODO. Único que puede crear nuevos owners.
 *  - owner: dueño del negocio (cliente de Vestel). Pertenece a SU org y
 *    es `owner_user_id` de ella. Ve todos los peritajes de su org
 *    (propios + de sus empleados) y gestiona empleados/empresa/WhatsApp
 *    de la org.
 *  - employee: perito asalariado de un owner. Pertenece a la org del
 *    owner que lo dio de alta. Solo ve y edita SUS propios peritajes;
 *    no accede a /empresa, /usuarios, /backup ni a peritajes de otros.
 *
 * Filas legacy: role='perito' se mapeó a 'owner' en la migración previa.
 */
export type UserRole = "admin" | "owner" | "employee";

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
  /** Si la sesión actual es un impersonate de admin, acá viene el user_id del
   *  admin original. Permite al cliente mostrar el banner "Estás operando
   *  como X" y al backend auditarlo. null en sesiones normales. */
  impersonatedBy?: string | null;
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
    role:
      row.role === "admin"
        ? "admin"
        : row.role === "employee"
          ? "employee"
          : "owner",
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

/**
 * Lista usuarios respetando el scope del actor:
 *  - admin   → ve a todos (incluye admins y owners de otras orgs)
 *  - owner   → ve a los miembros de SU org (a sí mismo y a sus empleados)
 *  - employee → ve solo a sí mismo (es un solo registro, pero la UI puede
 *               usar esto para consultas como "mi perfil" sin tocar otra API).
 */
export async function listUsersFor(actor: User): Promise<User[]> {
  if (actor.role === "admin") {
    const r = await query<UserRow>(
      "SELECT * FROM users ORDER BY created_at ASC",
    );
    return r.rows.map(rowToUser);
  }
  if (actor.role === "owner") {
    const r = await query<UserRow>(
      `SELECT * FROM users
       WHERE org_id = $1
       ORDER BY created_at ASC`,
      [actor.orgId],
    );
    return r.rows.map(rowToUser);
  }
  // employee: solo a sí mismo.
  const r = await query<UserRow>(
    "SELECT * FROM users WHERE id = $1",
    [actor.id],
  );
  return r.rows.map(rowToUser);
}

/** Versión legacy sin scope — solo para callers internos que ya filtraron
 *  o que son inherentemente admin (p.ej. migraciones, scripts). NO usar
 *  desde APIs HTTP sin un check de rol explícito. */
export async function listUsersUnscoped(): Promise<User[]> {
  const r = await query<UserRow>(
    "SELECT * FROM users ORDER BY created_at ASC",
  );
  return r.rows.map(rowToUser);
}

// Compat: el código existente importa `listUsers`. Mantenemos el nombre pero
// ahora exige el actor, así nadie puede llamarlo sin pensar en el scope.
export const listUsers = listUsersFor;

/**
 * Lista de teléfonos WhatsApp del equipo activo dentro de una org. Usado
 * para fan-out de notificaciones internas (intake nuevo, firma completada).
 * Devuelve solo usuarios activos con `wa_phone` configurado dentro de la
 * org dada. El admin (org_id=NULL) NO se incluye — los avisos del equipo
 * van al dueño y sus empleados, no a Vestel.
 */
export async function listTeamWhatsAppPhones(
  orgId: string | null,
): Promise<Array<{ id: string; fullName: string; waPhone: string }>> {
  // Sin org → no hay equipo a notificar. Devolvemos array vacío para que el
  // caller no se rompa pero tampoco mande mensajes raros a admins.
  if (!orgId) return [];
  const r = await query<{ id: string; full_name: string; wa_phone: string }>(
    `SELECT id, full_name, wa_phone
     FROM users
     WHERE org_id = $1
       AND active = TRUE
       AND wa_phone IS NOT NULL
       AND wa_phone <> ''`,
    [orgId],
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

/**
 * Valida y normaliza un correo. La normalización (trim + minúsculas) tiene que
 * ser LA MISMA que usa el índice único `idx_users_email_unique`, o se colarían
 * duplicados que difieren solo en mayúsculas.
 *
 * La regex es deliberadamente laxa: validar correos "bien" es imposible y lo
 * único que prueba de verdad que un correo existe es mandarle un mensaje.
 */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

/**
 * Busca por correo, con la misma normalización del índice único.
 *
 * Lo usa el flujo de "olvidé mi contraseña". Devuelve la fila cruda porque el
 * caller necesita `active` para decidir, sin exponer el usuario a nadie.
 */
export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const r = await query<UserRow>(
    "SELECT * FROM users WHERE lower(btrim(email)) = $1",
    [normalized],
  );
  return r.rows[0] ?? null;
}

export type CreateUserInput = {
  username: string;
  password: string;
  fullName: string;
  email?: string | null;
  role?: UserRole;
  /** Org del nuevo usuario. Si el rol es admin, debe ser null. */
  orgId?: string | null;
  /** Quién está dando de alta este usuario. Útil para audit (owner que crea
   *  employee → parent_user_id apunta al owner). */
  parentUserId?: string | null;
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

  // El correo dejó de ser opcional: es la única forma de que la persona
  // recupere su cuenta sola (ver /recuperar). Los usuarios históricos sin
  // correo siguen funcionando, pero no se crean nuevos así.
  const email = normalizeEmail(input.email ?? "");
  if (!email) {
    throw new Error(
      input.email?.trim()
        ? "El correo no parece válido."
        : "El correo es requerido: es lo que permite recuperar la contraseña.",
    );
  }
  const emailTaken = await getUserByEmail(email);
  if (emailTaken) {
    throw new Error("Ya hay una cuenta con ese correo.");
  }

  const role = input.role ?? "owner";
  // Reglas de consistencia rol ↔ org:
  //  - admin SIEMPRE va sin org_id (es global).
  //  - employee SIEMPRE va con org_id (el del owner que lo crea).
  //  - owner puede ir sin org_id de entrada porque el caller (API) suele
  //    crear la org en un paso siguiente y luego asociarla via setUserOrg.
  const orgId = role === "admin" ? null : input.orgId ?? null;
  if (role === "employee" && !orgId) {
    throw new Error("Un empleado debe estar asociado a una organización.");
  }

  const existing = await getUserByUsername(username);
  if (existing) {
    throw new Error("Ese usuario ya existe.");
  }

  const id = makeId();
  const hash = await hashPassword(input.password);

  await query(
    `INSERT INTO users (id, username, password_hash, full_name, email, role, org_id, parent_user_id, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)`,
    [
      id,
      username,
      hash,
      input.fullName.trim(),
      email,
      role,
      orgId,
      input.parentUserId ?? null,
    ],
  );

  const created = await getUserById(id);
  if (!created) throw new Error("No se pudo crear el usuario.");
  await logAudit(
    input.parentUserId ?? id,
    "user.created",
    JSON.stringify({ username, role, orgId }),
  );
  return created;
}

/** Cambia la org de un usuario. Usado para asociar un owner recién creado a
 *  su org auto-creada. No tocar manualmente desde una API sin un caso de
 *  uso muy claro — la membresía suele heredarse al crear el usuario. */
export async function setUserOrg(
  userId: string,
  orgId: string | null,
  changedBy: string | null,
): Promise<void> {
  await query("UPDATE users SET org_id = $1 WHERE id = $2", [orgId, userId]);
  await logAudit(
    changedBy,
    "user.org_changed",
    JSON.stringify({ userId, orgId }),
  );
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
    // El correo identifica la cuenta para recuperar la contraseña, así que se
    // valida y se normaliza igual que en createUser. La unicidad se chequea
    // acá (excluyendo la propia fila) para dar un mensaje entendible: sin
    // esto, el índice idx_users_email_unique reventaría con un 23505 crudo.
    const raw = patch.email?.trim() ?? "";
    if (!raw) {
      throw new Error(
        "El correo es requerido: es lo que permite recuperar la contraseña.",
      );
    }
    const email = normalizeEmail(raw);
    if (!email) throw new Error("El correo no parece válido.");
    const taken = await getUserByEmail(email);
    if (taken && taken.id !== id) {
      throw new Error("Ya hay una cuenta con ese correo.");
    }
    sets.push(`email = $${i++}`);
    params.push(email);
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
  const r = await query<
    UserRow & {
      s_expires_at: Date | string;
      org_active: boolean | null;
      impersonated_by: string | null;
    }
  >(
    `SELECT u.*, s.expires_at AS s_expires_at,
            s.impersonated_by AS impersonated_by,
            o.active AS org_active
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN organizations o ON o.id = u.org_id
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
  // Empresa suspendida: bloqueamos el acceso de todos sus users y limpiamos
  // la sesión. Admin (org_id NULL) no se ve afectado — el LEFT JOIN devuelve
  // org_active=NULL y dejamos pasar. Si la sesión es un impersonate de
  // admin, tampoco bloqueamos (el admin necesita poder entrar a una org
  // suspendida para diagnosticar).
  if (row.org_id && row.org_active === false && !row.impersonated_by) {
    await destroySession(sessionId);
    return null;
  }
  const user = rowToUser(row);
  if (row.impersonated_by) user.impersonatedBy = row.impersonated_by;
  return user;
}

/** Crea una sesión "impersonate": el adminId actúa como targetUserId. La
 *  sesión guarda original_session_id para poder restaurar al admin con su
 *  sesión original al salir, sin re-loguear. */
export async function createImpersonateSession(args: {
  adminId: string;
  targetUserId: string;
  originalSessionId: string;
  userAgent?: string | null;
}): Promise<string> {
  const sid = `imp_${crypto.randomBytes(20).toString("base64url")}`;
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1h
  await query(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent, impersonated_by, original_session_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      sid,
      args.targetUserId,
      expires,
      args.userAgent ?? null,
      args.adminId,
      args.originalSessionId,
    ],
  );
  await logAudit(
    args.adminId,
    "session.impersonate.start",
    JSON.stringify({ targetUserId: args.targetUserId }),
  );
  return sid;
}

/** Lee la sesión original_session_id de una sesión impersonate. Devuelve
 *  null si la sesión no es impersonate, expiró o ya no existe. */
export async function readImpersonateOriginal(
  sessionId: string,
): Promise<{ originalSessionId: string; adminId: string } | null> {
  const r = await query<{
    impersonated_by: string | null;
    original_session_id: string | null;
  }>(
    `SELECT impersonated_by, original_session_id
       FROM sessions WHERE id = $1`,
    [sessionId],
  );
  const row = r.rows[0];
  if (!row?.impersonated_by || !row?.original_session_id) return null;
  // Confirmar que la sesión original sigue viva.
  const orig = await query<{ id: string }>(
    "SELECT id FROM sessions WHERE id = $1 AND expires_at > now()",
    [row.original_session_id],
  );
  if (orig.rowCount === 0) return null;
  return {
    originalSessionId: row.original_session_id,
    adminId: row.impersonated_by,
  };
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
