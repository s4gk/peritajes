"use client";

/**
 * Wrapper de fetch que inyecta automáticamente el header `x-csrf-token` en
 * requests no idempotentes (POST/PUT/PATCH/DELETE), leyendo el valor de la
 * cookie `perito_csrf` que el server emitió al loguearse.
 *
 * Para GET/HEAD/OPTIONS se comporta igual que `fetch`. Si por alguna razón la
 * cookie no está presente (sesión expirada, cookies bloqueadas) el request
 * sale igual sin header — el server contesta 403 csrf_invalid y la UI puede
 * reaccionar.
 */

const CSRF_COOKIE = "perito_csrf";
const CSRF_HEADER = "x-csrf-token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)perito_csrf=([^;]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers ?? undefined);
  if (!SAFE_METHODS.has(method)) {
    const token = readCsrfCookie();
    if (token && !headers.has(CSRF_HEADER)) {
      headers.set(CSRF_HEADER, token);
    }
  }
  return fetch(input, { ...init, headers });
}

export { CSRF_COOKIE, CSRF_HEADER };
