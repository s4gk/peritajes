"use client";

import {
  createWorker,
  PSM,
  type Worker as TesseractWorker,
} from "tesseract.js";

import {
  type CardSide,
  correctVinForbiddenChars,
  detectSide,
  type OcrLine,
  parseLicenciaTransito,
  parseLicenciaTransitoFromOcr,
  toVehicleFormFields,
  type VehicleFormFields,
} from "@/lib/licenciaTransitoParser";

// Alias retro-compatible: muchos callers todavía piensan en
// `ExtractedOwnershipCard`. El parser nuevo devuelve la misma forma de campos
// (claves en inglés) que el formulario espera — así que solo le ponemos otro
// nombre al tipo y listo.
export type ExtractedOwnershipCard = VehicleFormFields;

/**
 * OCR de la tarjeta de propiedad corriendo 100% en el navegador.
 *
 * Por qué cliente y no servidor:
 *  - Cero upload — la foto nunca sale del celular. En 3G/4G subir 2-4MB tarda
 *    más que el OCR mismo.
 *  - Cero presión de CPU en el server (Tesseract es CPU-bound; con varios
 *    peritos concurrentes el server se saturaba).
 *  - El usuario ve % de progreso real, no un spinner indefinido.
 *
 * El lang pack `spa.traineddata.gz` se sirve desde /tessdata (public/ del
 * proyecto). El motor wasm de tesseract.js viene del CDN default — al ser
 * ~2MB y cacheable, el primer escaneo es lento (~5-8s) y los siguientes
 * arrancan en <1s.
 */

export type OcrProgress = {
  status: string;
  progress: number;
};

let workerPromise: Promise<TesseractWorker> | null = null;

function getWorker(onProgress?: (p: OcrProgress) => void): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await createWorker("spa", 1, {
        langPath: "/tessdata",
        logger: (m: { status?: string; progress?: number }) => {
          if (typeof m.progress === "number" && typeof m.status === "string") {
            onProgress?.({ status: m.status, progress: m.progress });
          }
        },
      });
      // Mismo tuning que en server: bloque único + preservar espacios entre
      // palabras. PSM.SINGLE_BLOCK es el modo correcto para tarjetas/cédulas
      // donde no hay layout de página tipo libro.
      await w.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1",
      });
      return w;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/**
 * Permite "calentar" el worker antes de que el perito tome la foto — al abrir
 * el dialog del escáner se descarga el wasm y el lang pack en background, y
 * cuando llega la foto el recognize() arranca casi instantáneo.
 */
export function warmUpOcr(): void {
  void getWorker().catch(() => {
    // No tirar — si falla acá, falla también en recognize() y ahí se reporta.
  });
}

/**
 * Libera el worker. Útil al desmontar el componente para no dejar el wasm
 * vivo si el perito ya no va a escanear más.
 */
export async function disposeOcr(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  if (p) {
    try {
      const w = await p;
      await w.terminate();
    } catch {
      /* worker ya estaba muerto o nunca arrancó */
    }
  }
}

// Chars permitidos en un VIN ISO 3779 + espacio (no I, O, Q). Lo usamos como
// whitelist de Tesseract en la segunda pasada sobre la línea del VIN/chasis,
// para que el motor no devuelva caracteres que sabemos imposibles. Reduce
// errores como O→0, I→1 y previene ruido de signos de puntuación.
const VIN_WHITELIST = "0123456789ABCDEFGHJKLMNPRSTUVWXYZ ";

// Identifica una palabra que parece un VIN/chasis: 15-18 chars alfanuméricos
// (los VINs son 17, pero damos margen porque el OCR puede partir o pegar
// chars con la palabra siguiente). 17 exactos sería más estricto pero
// perderíamos casos parciales que la segunda pasada puede recuperar.
const VIN_LIKE = /\b[A-Z0-9]{15,18}\b/i;

export type RecognitionResult = {
  /** Campos extraídos, ya adaptados a la forma que consume el formulario. */
  fields: VehicleFormFields;
  /** Texto crudo de la primera pasada de Tesseract. Lo exponemos para depurar
   *  cuando el parser no detecta campos: el perito puede verlo en la UI y así
   *  distinguimos "OCR leyó mal" de "OCR leyó OK pero parser no matchea". */
  rawText: string;
  /** Lista de campos extraídos que fallaron validación (p.ej. licencia con
   *  número incorrecto de dígitos, VIN con I/O/Q). Útil para mostrarle al
   *  perito qué necesita revisar antes de aplicar. */
  warnings: string[];
  /** 0–1, score de qué tan completo y limpio quedó el escaneo. */
  confidence: number;
  /** Cara detectada de la tarjeta a partir del rawText (frente / reverso /
   *  desconocido). Sirve para avisarle al perito si escaneó la cara
   *  equivocada respecto del botón que tocó. */
  side: CardSide;
};

export async function recognizeOwnershipCard(
  image: Blob | HTMLCanvasElement,
  opts?: { onProgress?: (p: OcrProgress) => void; signal?: AbortSignal },
): Promise<RecognitionResult> {
  if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const worker = await getWorker(opts?.onProgress);
  if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Primera pasada: bloque completo con español, para extraer todos los campos
  // y obtener bboxes por línea.
  const result = await worker.recognize(image, undefined, { blocks: true });
  if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const rawText = result.data.text ?? "";
  // Parser espacial: usa las posiciones X/Y reales de cada palabra (vienen en
  // result.data.blocks) para alinear columnas. Es mucho más robusto que el
  // text-based cuando el OCR pega columnas con espacios simples — ej:
  // "BPA481 PEUGEOT" tiene un espacio simple pero Tesseract sabe que están en
  // columnas distintas porque sus bboxes están separados horizontalmente.
  const ocrLines = extractOcrLines(result.data.blocks);
  // Si por alguna razón no obtuvimos palabras con bbox (Tesseract a veces
  // entrega blocks vacíos), caemos al parser text-based como red de seguridad.
  const parsed =
    ocrLines.length > 0
      ? parseLicenciaTransitoFromOcr(ocrLines)
      : parseLicenciaTransito(rawText);
  const fields = toVehicleFormFields(parsed.data);

  // Segunda pasada SOLO sobre las líneas que tienen pinta de VIN/chasis, con
  // whitelist restringida a chars VIN y PSM=SINGLE_LINE. Es donde Tesseract
  // más mete la pata (alfanuméricos largos en fuente densa). Si la línea
  // re-leída produce un VIN válido distinto al de la primera pasada, pisamos.
  try {
    const candidates = collectIdLineRects(result.data.blocks).slice(0, 3);
    if (candidates.length > 0) {
      await worker.setParameters({
        tessedit_char_whitelist: VIN_WHITELIST,
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      });
      try {
        const seen = new Set<string>();
        for (const rect of candidates) {
          if (opts?.signal?.aborted)
            throw new DOMException("Aborted", "AbortError");
          const second = await worker.recognize(image, { rectangle: rect });
          for (const token of extractIdTokens(second.data.text)) {
            if (seen.has(token)) continue;
            seen.add(token);
            applyIdToken(fields, token);
          }
        }
      } finally {
        // Reset: dejamos el worker en el mismo estado para que próximos
        // recognize() corran en español/bloque sin whitelist.
        await worker.setParameters({
          tessedit_char_whitelist: "",
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        });
      }
    }
  } catch (err) {
    // Si la segunda pasada falla por cualquier razón (rectángulo inválido,
    // worker en mal estado), nos quedamos con los resultados de la primera.
    // No queremos romper toda la captura por un refinement que no funcionó.
    if ((err as { name?: string })?.name === "AbortError") throw err;
    // eslint-disable-next-line no-console
    console.warn("[ocr] segunda pasada falló:", err);
  }

  if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return {
    fields,
    rawText,
    warnings: parsed.warnings,
    confidence: parsed.confidence,
    side: detectSide(rawText),
  };
}

type Block = NonNullable<
  Awaited<ReturnType<TesseractWorker["recognize"]>>["data"]["blocks"]
>[number];

/**
 * Convierte la estructura blocks→paragraphs→lines→words de Tesseract a la
 * forma `OcrLine[]` que consume el parser espacial. Conservamos las bboxes
 * tal cual las devuelve Tesseract (en píxeles de la imagen original).
 */
function extractOcrLines(blocks: Block[] | null): OcrLine[] {
  if (!blocks) return [];
  const out: OcrLine[] = [];
  for (const block of blocks) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const words = (line.words ?? [])
          .map((w) => ({
            text: (w.text ?? "").trim(),
            x0: w.bbox?.x0 ?? 0,
            y0: w.bbox?.y0 ?? 0,
            x1: w.bbox?.x1 ?? 0,
            y1: w.bbox?.y1 ?? 0,
          }))
          .filter((w) => w.text.length > 0);
        if (words.length > 0) out.push({ words });
      }
    }
  }
  return out;
}

// Recorre la estructura blocks→paragraphs→lines y devuelve los bboxes de las
// líneas cuyo texto contiene un alfanumérico de 15-18 chars. Le agrega un
// padding de 4px para que el recorte no corte el primer/último glyph.
function collectIdLineRects(blocks: Block[] | null): {
  left: number;
  top: number;
  width: number;
  height: number;
}[] {
  if (!blocks) return [];
  const out: { left: number; top: number; width: number; height: number }[] = [];
  for (const block of blocks) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const text = line.text ?? "";
        if (!VIN_LIKE.test(text)) continue;
        const b = line.bbox;
        if (!b) continue;
        const pad = 4;
        out.push({
          left: Math.max(0, b.x0 - pad),
          top: Math.max(0, b.y0 - pad),
          width: Math.max(1, b.x1 - b.x0 + pad * 2),
          height: Math.max(1, b.y1 - b.y0 + pad * 2),
        });
      }
    }
  }
  return out;
}

// Saca todos los tokens alfanuméricos de 15-18 chars del texto de una pasada
// con whitelist VIN. Como la whitelist sólo permite [0-9A-Z ] sin IOQ, lo que
// venga es directamente un candidato a ID limpio.
function extractIdTokens(text: string): string[] {
  const upper = text.toUpperCase();
  const out: string[] = [];
  const re = /[A-Z0-9]{15,18}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(upper)) !== null) {
    out.push(m[0]);
  }
  return out;
}

// Mergea un token de la segunda pasada en los campos. Sólo pisa si:
//  - El campo destino existía pero difiere (entonces la segunda lectura tiene
//    mejor chance de ser correcta porque viene con whitelist).
//  - O el campo destino estaba vacío.
// VIN se prefiere de 17 chars; chasis acepta 15-18.
function applyIdToken(fields: VehicleFormFields, token: string): void {
  const t = correctVinForbiddenChars(token);
  if (t.length === 17) {
    if (fields.vin !== t) fields.vin = t;
    // Si chasis era copia del VIN (caso fallback común), también lo
    // refrescamos para mantenerlos consistentes.
    if (!fields.chassisNumber || fields.chassisNumber.length === 17) {
      fields.chassisNumber = t;
    }
    return;
  }
  if (t.length >= 15 && t.length <= 18 && !fields.chassisNumber) {
    fields.chassisNumber = t;
  }
}
