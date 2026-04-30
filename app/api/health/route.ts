import { NextResponse } from "next/server";

import { query } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = Date.now();

export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};
  let dbLatencyMs: number | null = null;

  try {
    const t0 = Date.now();
    await query("SELECT 1");
    dbLatencyMs = Date.now() - t0;
    checks.db = "ok";
  } catch {
    checks.db = "fail";
  }

  const ok = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      dbLatencyMs,
      checks,
    },
    {
      status: ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
