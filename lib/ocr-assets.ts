/**
 * Archivos del OCR local (tesseract.js) servidos desde nuestro propio origen
 * en vez del CDN de jsdelivr, para que el OCR funcione sin internet: el
 * service worker los precachea (ver public/sw.js y /api/offline/manifest).
 *
 * La versión va en la URL (`/tesseract/<versión>/...`) para que los archivos
 * sean inmutables y cambien de URL cuando se actualice la librería.
 */
import tesseractPkg from "tesseract.js/package.json";

export const TESSERACT_VERSION: string = tesseractPkg.version;
export const TESSERACT_BASE = `/tesseract/${TESSERACT_VERSION}`;
export const TESSERACT_WORKER_FILE = "worker.min.js";
/** Variantes del core LSTM (OEM 1, la que usamos). tesseract.js elige una
 *  según lo que soporte el celular (SIMD relajado > SIMD > básico). */
export const TESSERACT_CORE_FILES = [
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-lstm.wasm.js",
] as const;
export const TESSDATA_FILES = ["/tessdata/spa.traineddata.gz"];
/** Cache del SW para el OCR: NO depende de la VERSION del SW (pesa ~12 MB y
 *  no tiene sentido rebajarlo en cada deploy), solo de la versión de
 *  tesseract.js. */
export const OCR_CACHE_NAME = `perito-ocr-${TESSERACT_VERSION}`;

export function ocrAssetUrls(coreFile?: string | null): string[] {
  const cores =
    coreFile && (TESSERACT_CORE_FILES as readonly string[]).includes(coreFile)
      ? [coreFile]
      : [...TESSERACT_CORE_FILES];
  return [
    `${TESSERACT_BASE}/${TESSERACT_WORKER_FILE}`,
    ...cores.map((f) => `${TESSERACT_BASE}/${f}`),
    ...TESSDATA_FILES,
  ];
}
