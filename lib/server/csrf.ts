import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/**
 * CSRF protection — patrón double-submit cookie.
 *
 * Flujo:
 *   1. Server emite la cookie `perito_csrf` (no httpOnly, accesible vía JS).
 *   2. El cliente lee la cookie y manda su valor en el header `x-csrf-token`
 *      en cada POST/PUT/PATCH/DELETE.
 *   3. middleware.ts compara cookie vs header — si difieren, 403.
 *
 * Como un origen externo no puede leer la cookie ni setear el header
 * arbitrariamente (no le sirve mandar la cookie del usuario porque no la
 * puede leer), no puede falsificar la combinación → CSRF mitigado.
 *
 * sameSite: "lax" en la sesión ya cubre la mayoría de los vectores; el CSRF
 * token es el cinturón sobre los tirantes.
 */

export const CSRF_COOKIE = "perito_csrf";
export const CSRF_HEADER = "x-csrf-token";

const CSRF_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 días

function shouldMarkCookieSecure(): boolean {
  if (process.env.COOKIE_INSECURE === "true") return false;
  if (process.env.COOKIE_SECURE === "true") return true;
  return process.env.NODE_ENV === "production";
}

/**
 * Si ya existe la cookie CSRF, la devuelve. Si no, genera una nueva, la setea
 * y la devuelve. Idempotente — se puede llamar en cada request autenticado
 * sin rotar el token de fondo.
 */
export function ensureCsrfCookie(): string {
  const c = cookies();
  const existing = c.get(CSRF_COOKIE)?.value;
  if (existing && existing.length >= 16) return existing;
  const token = randomBytes(24).toString("base64url");
  c.set(CSRF_COOKIE, token, {
    httpOnly: false, // double-submit necesita que JS pueda leerla
    sameSite: "lax",
    secure: shouldMarkCookieSecure(),
    path: "/",
    maxAge: CSRF_TTL_SECONDS,
  });
  return token;
}

export function clearCsrfCookie(): void {
  cookies().set(CSRF_COOKIE, "", {
    httpOnly: false,
    sameSite: "lax",
    secure: shouldMarkCookieSecure(),
    path: "/",
    maxAge: 0,
  });
}
