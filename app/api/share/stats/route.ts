import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { query } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/share/stats
 * Métricas agregadas del programa de share links: cuántos se emitieron,
 * cuántas veces los clientes los abrieron, y qué porcentaje de peritajes
 * tienen al menos un link vivo. Lo consume el dashboard para medir
 * engagement de los clientes finales.
 */
export async function GET() {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "no_auth" }, { status: 401 });
  }

  const totalsRes = await query<{
    total_links: string;
    total_accesses: string;
    accessed_links: string;
    live_links: string;
    inspections_shared: string;
  }>(
    `SELECT
       COUNT(*)::text AS total_links,
       COALESCE(SUM(access_count), 0)::text AS total_accesses,
       COUNT(*) FILTER (WHERE last_accessed_at IS NOT NULL)::text AS accessed_links,
       COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now())::text AS live_links,
       COUNT(DISTINCT inspection_id)::text AS inspections_shared
     FROM share_tokens`,
  );
  const row = totalsRes.rows[0] ?? {
    total_links: "0",
    total_accesses: "0",
    accessed_links: "0",
    live_links: "0",
    inspections_shared: "0",
  };

  return NextResponse.json({
    totalLinks: Number(row.total_links),
    totalAccesses: Number(row.total_accesses),
    accessedLinks: Number(row.accessed_links),
    liveLinks: Number(row.live_links),
    inspectionsShared: Number(row.inspections_shared),
  });
}
