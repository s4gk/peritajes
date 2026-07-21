import { NextResponse, type NextRequest } from "next/server";

/**
 * CSRF middleware (double-submit cookie). Aplica solo a /api/* en métodos no
 * idempotentes. Métodos seguros (GET/HEAD/OPTIONS) y endpoints sin sesión
 * (login, setup, sign-callback público) quedan exentos.
 *
 * Además, en GETs a páginas del panel sembramos la cookie CSRF si falta — no
 * podemos hacerlo desde el layout (Server Component no puede mutar cookies),
 * así que lo cubre el middleware.
 *
 * No tocamos /r/[token] porque ese flujo es público (cliente sin login bajando
 * un PDF) y va por GET.
 */

const CSRF_COOKIE = "perito_csrf";
const CSRF_HEADER = "x-csrf-token";
const CSRF_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 días
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Rutas del panel donde se siembra la cookie CSRF.
//
// OJO: esta lista y el `matcher` de abajo tienen que cubrir lo mismo, y ambas
// deben cubrir todo app/(panel)/. Si una ruta está acá pero no en el matcher,
// el middleware ni corre: quien entre directo a esa sección (deep link o
// start_url de la PWA) se queda sin cookie y TODAS sus mutaciones responden
// 403 csrf_invalid hasta que navegue a otra parte.
const PANEL_PATHS = [
  "/peritajes",
  "/inspection",
  "/intake",
  "/dashboard",
  "/cuenta",
  "/empresa",
  "/usuarios",
  "/vehiculos",
  "/backup",
  "/agenda",
  "/auditoria",
  "/whatsapp",
  "/clientes",
  "/propietarios",
  "/admin",
];

function shouldMarkCookieSecure(): boolean {
  if (process.env.COOKIE_INSECURE === "true") return false;
  if (process.env.COOKIE_SECURE === "true") return true;
  return process.env.NODE_ENV === "production";
}

function randomToken(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function seedCsrfCookie(req: NextRequest, res: NextResponse) {
  const existing = req.cookies.get(CSRF_COOKIE)?.value;
  if (existing && existing.length >= 16) return;
  res.cookies.set(CSRF_COOKIE, randomToken(24), {
    httpOnly: false,
    sameSite: "lax",
    secure: shouldMarkCookieSecure(),
    path: "/",
    maxAge: CSRF_TTL_SECONDS,
  });
}

function isPanelPath(pathname: string): boolean {
  return PANEL_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

// Endpoints que NO requieren CSRF token:
//  - /api/auth/login y /api/auth/setup: el usuario aún no tiene sesión y por
//    ende tampoco cookie CSRF. Confiamos en rate limit + sameSite=lax.
//  - /api/sign/session/[token]: lo postea el celular del cliente firmante
//    (no perito), que no tiene sesión Perito. La autenticación del POST es
//    la posesión del token de la sesión de firma (single-use, 10 min TTL).
//  - /api/health: monitoring.
//  - /api/webhooks/*: los llaman servicios externos (Meta, Twilio) que no
//    pueden mandar cookie CSRF. Se autentican por firma del proveedor
//    (X-Hub-Signature-256 de Meta / X-Twilio-Signature), no por CSRF.
const EXEMPT_EXACT = new Set([
  "/api/auth/login",
  "/api/auth/setup",
  // Solicitud de recuperación de contraseña: es pre-sesión, igual que login,
  // así que no hay cookie CSRF que exigir. Va protegido por rate limit y por
  // no revelar nunca si el correo existe.
  "/api/auth/forgot",
  "/api/health",
  "/api/webhooks/whatsapp",
  "/api/webhooks/twilio",
]);

function isExempt(pathname: string): boolean {
  if (EXEMPT_EXACT.has(pathname)) return true;
  // /api/sign/session/<token> — el path con [token] dinámico
  if (/^\/api\/sign\/session\/[^/]+$/.test(pathname)) return true;
  // /api/auth/reset/<token> — reset de contraseña sin sesión (el token mismo
  // autentica el request, igual que sign/session).
  if (/^\/api\/auth\/reset\/[^/]+$/.test(pathname)) return true;
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith("/api/")) {
    if (SAFE_METHODS.has(req.method) && isPanelPath(pathname)) {
      const res = NextResponse.next();
      seedCsrfCookie(req, res);
      return res;
    }
    return NextResponse.next();
  }

  if (SAFE_METHODS.has(req.method)) return NextResponse.next();
  if (isExempt(pathname)) return NextResponse.next();

  const cookieToken = req.cookies.get(CSRF_COOKIE)?.value;
  const headerToken = req.headers.get(CSRF_HEADER);
  if (
    !cookieToken ||
    !headerToken ||
    cookieToken.length < 16 ||
    cookieToken !== headerToken
  ) {
    return NextResponse.json(
      { error: "csrf_invalid" },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/peritajes/:path*",
    "/peritajes",
    "/inspection/:path*",
    "/intake/:path*",
    "/intake",
    "/dashboard/:path*",
    "/dashboard",
    "/cuenta/:path*",
    "/cuenta",
    "/empresa/:path*",
    "/empresa",
    "/usuarios/:path*",
    "/usuarios",
    "/vehiculos/:path*",
    "/vehiculos",
    "/backup/:path*",
    "/backup",
    "/agenda/:path*",
    "/agenda",
    "/auditoria/:path*",
    "/auditoria",
    "/whatsapp/:path*",
    "/whatsapp",
    "/clientes/:path*",
    "/clientes",
    "/propietarios/:path*",
    "/propietarios",
    "/admin/:path*",
    "/admin",
  ],
};
