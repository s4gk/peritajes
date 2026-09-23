import { NextResponse } from "next/server";

import { listOfflineAssets } from "@/lib/server/offline-manifest";

export const dynamic = "force-dynamic";

/**
 * GET /api/offline/manifest — assets que el service worker precachea para el
 * modo sin internet (ver public/sw.js). Público: solo lista nombres de archivos
 * estáticos que igual se sirven sin sesión.
 */
export async function GET() {
  const assets = await listOfflineAssets();
  return NextResponse.json(
    { assets },
    { headers: { "cache-control": "no-store" } },
  );
}
