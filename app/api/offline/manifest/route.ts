import { NextResponse } from "next/server";

import { OCR_CACHE_NAME, ocrAssetUrls } from "@/lib/ocr-assets";
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
    {
      assets,
      // OCR local: el SW lo guarda en un cache aparte que sobrevive a los
      // cambios de VERSION del SW (pesa ~12 MB).
      ocr: { cache: OCR_CACHE_NAME, assets: ocrAssetUrls() },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
