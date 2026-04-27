/**
 * Ephemeral in-process store for client-side QR signing sessions.
 *
 * A session is created by the perito in the summary step; the client then opens
 * /sign/[token] on their phone and posts a signature back. The perito's browser
 * polls the result endpoint until the signature arrives (or the session expires).
 *
 * This lives in module-level memory intentionally — for a self-hosted peritaje
 * app running a single Next.js process it's enough. If the app ever scales to
 * multi-instance, swap this for Redis/KV with the same public API.
 */

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

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
  signature?: string; // data URL once submitted
  createdAt: number;
  expiresAt: number;
  signedAt?: number;
};

// Ensure the Map survives hot reloads in dev so a freshly opened phone doesn't
// land on a stale token after the perito edits code.
const globalScope = globalThis as unknown as {
  __peritoSignSessions?: Map<string, SignSession>;
};
const sessions: Map<string, SignSession> =
  globalScope.__peritoSignSessions ?? new Map<string, SignSession>();
globalScope.__peritoSignSessions = sessions;

function prune(now: number) {
  for (const [token, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(token);
  }
}

function makeToken(): string {
  // 128 bits of entropy in a URL-safe 22-char string
  const bytes = new Uint8Array(16);
  // Prefer Web Crypto when available (Next.js node runtime has it globally)
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function createSession(context: SignSessionContext): SignSession {
  const now = Date.now();
  prune(now);
  const session: SignSession = {
    token: makeToken(),
    context,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessions.set(session.token, session);
  return session;
}

export function getSession(token: string): SignSession | null {
  const now = Date.now();
  prune(now);
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < now) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function submitSignature(token: string, signature: string): SignSession | null {
  const session = getSession(token);
  if (!session) return null;
  session.signature = signature;
  session.signedAt = Date.now();
  // Extend expiration slightly so the perito has a window to pick it up even if
  // they were slow to poll
  session.expiresAt = Math.max(session.expiresAt, Date.now() + 60_000);
  sessions.set(token, session);
  return session;
}

export function deleteSession(token: string): void {
  sessions.delete(token);
}
