import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/server/auth";
import { listAuditLog } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauth(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (msg === "FORBIDDEN")
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return unauth(e);
  }
  const url = new URL(req.url);
  const result = await listAuditLog({
    userId: url.searchParams.get("userId") || null,
    action: url.searchParams.get("action") || null,
    from: url.searchParams.get("from") || null,
    to: url.searchParams.get("to") || null,
    before: url.searchParams.get("before") || null,
    limit: Number(url.searchParams.get("limit")) || undefined,
  });
  return NextResponse.json(result);
}
