"use client";

/**
 * Compresión de fotos antes de guardarlas en IDB / mandarlas al server.
 *
 * Estrategia:
 *   - Decodifica el blob con `createImageBitmap` cuando está disponible: maneja
 *     orientación EXIF nativamente (importante en celular — un selfie/foto
 *     vertical de iPhone llegaba al canvas rotada 90° antes de esto).
 *   - Resize al max dimension preservando aspecto.
 *   - Codifica como JPEG y baja calidad iterativamente hasta caer bajo el
 *     target. Por defecto apuntamos a ~300KB por foto: 60 fotos × 300KB ≈ 18MB
 *     por peritaje, vs ~30MB con la compresión anterior.
 *
 * Para tirar PNG (firmas, capturas con transparencia) usar `kind: "png"` —
 * se respeta el blob original.
 */

export type CompressOptions = {
  /** Lado mayor máximo en píxeles. Default 1600 — suficiente para zoom razonable
   *  en el PDF y mantiene legible un VIN o número de chasis. */
  maxDimension?: number;
  /** Tamaño objetivo en bytes (base64 + headers excluidos). Default 300KB. */
  targetBytes?: number;
  /** Calidad JPEG inicial. Default 0.82. Baja en pasos de 0.08 hasta llegar al
   *  target o tocar piso. */
  initialQuality?: number;
  /** Calidad mínima a la que paramos (devolvemos lo último aunque pase del
   *  target). Default 0.45. */
  minQuality?: number;
  /** "auto" elige JPEG salvo que la fuente sea PNG con alfa real (raro en
   *  fotos del perito). Forzar "jpeg" o "png" para casos especiales. */
  kind?: "auto" | "jpeg" | "png";
};

const DEFAULTS = {
  maxDimension: 1600,
  targetBytes: 300 * 1024,
  initialQuality: 0.82,
  minQuality: 0.45,
  kind: "auto" as const,
};

/**
 * Aprox bytes que tiene el data URL en disco: el blob base64 pesa ~4/3 del
 * binario, así que dividimos por 1.37 para no comparar peras con manzanas
 * cuando el target está expresado en bytes binarios.
 */
function dataUrlOverhead(dataUrl: string): number {
  return Math.round(dataUrl.length / 1.37);
}

async function decodeToBitmap(
  blob: Blob,
): Promise<{ bitmap: ImageBitmap | HTMLImageElement; width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, {
        // `from-image` aplica la rotación EXIF — sin esto un IMG_xxx.jpg de
        // iPhone vertical llega acostado al canvas.
        imageOrientation: "from-image",
      });
      return { bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      /* algunos browsers/formatos viejos no lo soportan, caemos al fallback */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No se pudo decodificar la imagen."));
      i.src = url;
    });
    return { bitmap: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function buildCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export type CompressResult = {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  /** Mime real del output. */
  mime: "image/jpeg" | "image/png";
};

/**
 * Comprime un File/Blob y devuelve un data URL listo para guardar en IDB
 * o enviar al server. Si ya está bajo el target en su forma original
 * decodificada, igual pasa por el canvas — esto canoniza orientación EXIF y
 * elimina metadata sensible (GPS, etc.).
 */
export async function compressImage(
  input: Blob,
  options?: CompressOptions,
): Promise<CompressResult> {
  const opts = { ...DEFAULTS, ...options };
  const { bitmap, width: srcW, height: srcH } = await decodeToBitmap(input);
  if (!srcW || !srcH) {
    throw new Error("Imagen sin dimensiones legibles.");
  }

  const scale = Math.min(1, opts.maxDimension / Math.max(srcW, srcH));
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  const canvas = buildCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear el canvas.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  // Liberar el bitmap GPU-side lo antes posible — la app puede estar comprimiendo
  // 60 fotos en serie en un celular con RAM ajustada.
  if (bitmap instanceof ImageBitmap) bitmap.close();

  const wantsPng =
    opts.kind === "png" || (opts.kind === "auto" && input.type === "image/png");

  if (wantsPng) {
    const dataUrl = canvas.toDataURL("image/png");
    return {
      dataUrl,
      width: w,
      height: h,
      bytes: dataUrlOverhead(dataUrl),
      mime: "image/png",
    };
  }

  let quality = opts.initialQuality;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (
    dataUrlOverhead(dataUrl) > opts.targetBytes &&
    quality > opts.minQuality
  ) {
    quality = Math.max(opts.minQuality, quality - 0.08);
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  return {
    dataUrl,
    width: w,
    height: h,
    bytes: dataUrlOverhead(dataUrl),
    mime: "image/jpeg",
  };
}
