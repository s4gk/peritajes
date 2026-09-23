import { promises as fs } from "node:fs";
import path from "node:path";

import {
  TESSERACT_CORE_FILES,
  TESSERACT_VERSION,
  TESSERACT_WORKER_FILE,
} from "@/lib/ocr-assets";

export const dynamic = "force-dynamic";

/**
 * GET /tesseract/<versión>/<archivo> — worker y core wasm de tesseract.js
 * servidos desde node_modules (así no dependemos del CDN y el SW puede
 * precachearlos para el OCR sin internet). Solo una lista blanca de archivos.
 */
export async function GET(
  _req: Request,
  { params }: { params: { version: string; file: string } },
) {
  if (params.version !== TESSERACT_VERSION) {
    return new Response("Versión no disponible", { status: 404 });
  }
  let filePath: string | null = null;
  if (params.file === TESSERACT_WORKER_FILE) {
    filePath = path.join(process.cwd(), "node_modules", "tesseract.js", "dist", params.file);
  } else if ((TESSERACT_CORE_FILES as readonly string[]).includes(params.file)) {
    filePath = path.join(process.cwd(), "node_modules", "tesseract.js-core", params.file);
  }
  if (!filePath) return new Response("No encontrado", { status: 404 });
  try {
    const body = await fs.readFile(filePath);
    return new Response(body, {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
}
