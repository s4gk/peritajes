import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { scopeWhere } from "@/lib/server/inspections";

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
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "no_auth" }, { status: 401 });
  }

  // Los share_tokens no llevan org: se scopean por el peritaje al que apuntan,
  // con la misma visibilidad que usa el resto del panel. Sin este join, la
  // query agregaba sobre TODA la plataforma y cualquier employee veía las
  // métricas de todos los tenants.
  const scope = scopeWhere(user, "i");

  const totalsRes = await query<{
    total_links: string;
    total_accesses: string;
    accessed_links: string;
    live_links: string;
    inspections_shared: string;
  }>(
    `SELECT
       COUNT(*)::text AS total_links,
       COALESCE(SUM(st.access_count), 0)::text AS total_accesses,
       COUNT(*) FILTER (WHERE st.last_accessed_at IS NOT NULL)::text AS accessed_links,
       COUNT(*) FILTER (WHERE st.revoked_at IS NULL AND st.expires_at > now())::text AS live_links,
       COUNT(DISTINCT st.inspection_id)::text AS inspections_shared
     FROM share_tokens st
     JOIN inspections i ON i.id = st.inspection_id
     WHERE ${scope.sql}`,
    scope.params,
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
