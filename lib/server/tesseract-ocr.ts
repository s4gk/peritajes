import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createWorker, PSM, type Worker } from "tesseract.js";

import {
  type ExtractedOwnershipCard,
  parseOwnershipCardText,
} from "@/lib/ownership-card-parser";

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
    workerPromise = (async () => {
      const w = await createWorker("spa", 1, {
        langPath: LANG_PATH,
        cachePath,
      });
      // PSM 6 = un único bloque uniforme de texto. La tarjeta RUNT no es prosa,
      // es una grilla de etiquetas → valor; con el modo "auto" (PSM 3 default)
      // Tesseract se mata buscando estructura de página y tarda 3-5x más.
      // preserve_interword_spaces=1 evita que pegue "MARCATOYOTA" cuando el
      // espacio en blanco es estrecho, que es justo lo que el parser por
      // etiquetas necesita para encontrar los límites entre campos.
      await w.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1",
      });
      return w;
    })().catch((err) => {
      // Si la inicialización falla, no cacheamos la promesa rota.
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

// Si Tesseract se cuelga (raro pero pasa con imágenes degeneradas), matamos
// el worker y reseteamos el singleton para que el siguiente request arranque
// uno limpio. Mejor 30s perdidos que un worker zombi que bloquea todo el OCR.
const OCR_TIMEOUT_MS = 30_000;

export async function extractOwnershipCard(opts: {
  base64: string;
  mimeType: string;
}): Promise<ExtractedOwnershipCard> {
  const worker = await getWorker();
  const buffer = Buffer.from(opts.base64, "base64");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race<{ data: { text: string } }>([
      worker.recognize(buffer) as Promise<{ data: { text: string } }>,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          workerPromise = null;
          worker.terminate().catch(() => {
            /* el worker quedó en un estado raro — lo soltamos */
          });
          reject(new Error("OCR tardó demasiado. Probá con otra foto."));
        }, OCR_TIMEOUT_MS);
      }),
    ]);
    return parseOwnershipCardText(result.data.text);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
