import "server-only";

/**
 * Tiny in-memory rate limiter with a sliding window.
 *
 * Used to throttle the login endpoint so password guessing isn't trivial.
 * Single-process: state lives in `globalThis` so it survives Next.js dev
 * hot reloads and pm2 reload-cluster mode would still need every worker
 * to share state — fine for this app since pm2 runs `perito` as a single
 * fork process. If we ever cluster, swap this for a Postgres-backed table
 * or Redis with the same public API.
 */

type Bucket = { count: number; resetAt: number };

const globalScope = globalThis as unknown as {
  __peritoRateBuckets?: Map<string, Bucket>;
};
const buckets: Map<string, Bucket> =
  globalScope.__peritoRateBuckets ?? new Map();
globalScope.__peritoRateBuckets = buckets;

export type RateLimitConfig = {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max attempts per key inside the window. */
  max: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

export function rateLimitTake(
  key: string,
  cfg: RateLimitConfig,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + cfg.windowMs });
    return { allowed: true, remaining: cfg.max - 1, retryAfterSec: 0 };
  }
  if (existing.count >= cfg.max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil((existing.resetAt - now) / 1000),
    };
  }
  existing.count += 1;
  buckets.set(key, existing);
  return {
    allowed: true,
    remaining: cfg.max - existing.count,
    retryAfterSec: 0,
  };
}

export function rateLimitReset(key: string): void {
  buckets.delete(key);
}

/**
 * Periodic cleanup so very old entries don't pile up. Cheap O(n) sweep
 * triggered opportunistically — no separate timer needed.
 */
let lastCleanup = 0;
export function rateLimitMaybeSweep(): void {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [k, b] of buckets) {
    if (b.resetAt < now) buckets.delete(k);
  }
}

export function clientIpFromHeaders(headers: Headers): string {
  // x-forwarded-for from a reverse proxy beats whatever Next sees natively.
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
