import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";
import { extractOwnershipCard } from "@/lib/server/tesseract-ocr";
import {
  rateLimitMaybeSweep,
  rateLimitTake,
} from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OcrSchema = z.object({
  imageDataUrl: z.string().min(20).max(16 * 1024 * 1024),
});
// 60s para cubrir el primer warmup de Tesseract (descarga de 'spa.traineddata'
// del CDN de tessdata, ~1.5MB). Después de eso queda cacheado en disco y los
// requests siguientes resuelven en 1-3s.
export const maxDuration = 60;

/**
 * POST /api/ocr/ownership-card
 * Body: { imageDataUrl: "data:image/jpeg;base64,..." }
 *
 * Corre Tesseract en el server para extraer texto y un parser por etiquetas
 * lo convierte en campos estructurados de la tarjeta RUNT. Sin IA externa,
 * sin quota, sin costo por uso. Igual mantenemos rate-limit para evitar que
 * un usuario sature el server con CPU.
 */

const OCR_LIMIT = { windowMs: 60 * 60 * 1000, max: 30 };
const MAX_BYTES = 8 * 1024 * 1024; // 8MB tope para el upload

export async function POST(req: Request) {
  rateLimitMaybeSweep();

  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "no_auth" }, { status: 401 });
  }

  const rl = rateLimitTake(`ocr:${user.id}`, OCR_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        retryAfterSec: rl.retryAfterSec,
      },
      { status: 429 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = OcrSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const dataUrl = parsed.data.imageDataUrl.trim();
  if (!dataUrl.startsWith("data:")) {
    return NextResponse.json({ error: "missing_image" }, { status: 400 });
  }

  const match = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) {
    return NextResponse.json({ error: "invalid_image_format" }, { status: 400 });
  }
  const mimeType = match[1];
  const base64 = match[2];

  // Tope defensivo: base64 inflate ~33%, así que 8MB de payload son ~6MB binarios.
  if (base64.length > Math.ceil((MAX_BYTES * 4) / 3)) {
    return NextResponse.json({ error: "image_too_large" }, { status: 413 });
  }

  try {
    const fields = await extractOwnershipCard({ base64, mimeType });
    void logAudit(user.id, "ocr.ownership_card", JSON.stringify({ fields: Object.keys(fields).length }));
    return NextResponse.json({ fields });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: "ocr_failed", detail: message }, { status: 500 });
  }
}
