import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createWorker, type Worker } from "tesseract.js";

import {
  type ExtractedOwnershipCard,
  parseOwnershipCardText,
} from "./ownership-card-parser";

/**
 * OCR de la tarjeta de propiedad colombiana usando Tesseract (sin IA externa).
 * - Tesseract corre 100% en el server (Node) — cero costo por uso, cero quota.
 * - El primer escaneo descarga el lang pack 'spa' del CDN de tessdata y queda
 *   cacheado en `os.tmpdir()/perito-tessdata`. A partir de ahí, frío ~3s,
 *   caliente ~1-2s por foto en CPU típico.
 * - El parseo de texto crudo a campos vive en ./ownership-card-parser para
 *   que pueda testearse aislado.
 */

export type { ExtractedOwnershipCard };

// Worker singleton — la inicialización de tesseract es cara (carga wasm + lang
// pack) así que lo dejamos vivo entre requests. Node lo libera al terminar el
// proceso; pm2 lo recicla si re-arranca el server.
let workerPromise: Promise<Worker> | null = null;

// El lang pack 'spa.traineddata(.gz)' está versionado en lib/tessdata/. Así
// evitamos depender del CDN de jsdelivr en runtime: el primer request OCR
// arrancaba con descarga de 8MB y a veces se colgaba, dejando al perito mirando
// "Leyendo la tarjeta..." sin avanzar.
const LANG_PATH = path.join(process.cwd(), "lib", "tessdata");

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const cachePath = path.join(os.tmpdir(), "perito-tessdata");
    try {
      fs.mkdirSync(cachePath, { recursive: true });
    } catch {
      /* el dir ya existe o no podemos crearlo — tesseract caerá a su default */
    }
    workerPromise = createWorker("spa", 1, {
      langPath: LANG_PATH,
      cachePath,
    }).catch((err) => {
      // Si la inicialización falla, no cacheamos la promesa rota.
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

export async function extractOwnershipCard(opts: {
  base64: string;
  mimeType: string;
}): Promise<ExtractedOwnershipCard> {
  const worker = await getWorker();
  const buffer = Buffer.from(opts.base64, "base64");
  const { data } = await worker.recognize(buffer);
  return parseOwnershipCardText(data.text);
}
