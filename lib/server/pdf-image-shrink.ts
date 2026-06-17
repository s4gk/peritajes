import "server-only";

import sharp from "sharp";

/**
 * Re-comprime las fotos del peritaje server-side ANTES de meterlas al HTML
 * que va a Puppeteer. Sin esto, cada `data:image/jpeg;base64,...` se embebe
 * tal cual el client lo capturó (~300KB cada una, post-compressImage del
 * cliente), y un peritaje con 30 fotos llega a ~9MB de PDF.
 *
 * Target acá: 200KB max, JPEG 0.75, maxDim 1400px. Idempotente — si una
 * imagen ya pesa menos del target la devolvemos tal cual sin re-codificar.
 *
 * No procesamos firmas (PNG con transparencia) ni el QR de verificación
 * (es chico y vector-ish). Tampoco logos — los maneja el branding aparte.
 */

const TARGET_MAX_BYTES = 200 * 1024;
const MAX_DIM = 1400;
const JPEG_QUALITY = 75;

/** Estima los bytes binarios reales detrás de un dataURL base64 (sin contar
 *  el prefijo "data:image/jpeg;base64,"). */
function estimateBytes(dataUrl: string): number {
  const idx = dataUrl.indexOf(",");
  if (idx < 0) return dataUrl.length;
  const b64 = dataUrl.slice(idx + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function isJpegDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg");
}

function isPngDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith("data:image/png");
}

/** Decodifica el base64 a Buffer. Devuelve null si el dataURL es inválido. */
function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const idx = dataUrl.indexOf(",");
  if (idx < 0) return null;
  try {
    return Buffer.from(dataUrl.slice(idx + 1), "base64");
  } catch {
    return null;
  }
}

/** Re-comprime UNA foto. Si está bajo target o no es JPEG/PNG, devuelve el
 *  dataURL original. Si la decodificación falla, devuelve el original
 *  (defensive — preferimos un PDF con foto pesada a un PDF sin foto). */
export async function shrinkImageForPdf(dataUrl: string): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith("data:image/")) return dataUrl;
  // Firmas son PNG con transparencia — no las tocamos.
  if (isPngDataUrl(dataUrl)) return dataUrl;
  if (!isJpegDataUrl(dataUrl)) return dataUrl;

  const currentBytes = estimateBytes(dataUrl);
  if (currentBytes <= TARGET_MAX_BYTES) return dataUrl;

  const input = dataUrlToBuffer(dataUrl);
  if (!input) return dataUrl;

  try {
    const out = await sharp(input, { failOn: "none" })
      .rotate() // honra EXIF
      .resize({ width: MAX_DIM, height: MAX_DIM, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    // Si el resultado es paradójicamente más grande (raro: imagen ya optimizada),
    // dejamos el original.
    if (out.byteLength >= currentBytes) return dataUrl;
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return dataUrl;
  }
}

/** Prepara el logo de la organización para la marca de agua de fondo del PDF:
 *  lo escala chico y lo centra en un lienzo cuadrado transparente con amplio
 *  margen. Así, al tilearse como capa de `background-image` (background-size
 *  fijo de 52pt), el logo aparece pequeño y con aire — intercalado en damero
 *  con el ícono de herramientas (ver buildBgWatermarkStyle en pdf-template).
 *
 *  Por qué pre-padear con sharp en vez de un wrapper SVG: Chromium NO rinde
 *  `<image href="data:...">` embebido cuando el SVG se usa como background, así
 *  que el logo tiene que ir como raster directo — y un raster CSS ocupa todo su
 *  tile, sin forma de darle margen salvo metiéndoselo en el propio bitmap.
 *
 *  Acepta PNG/JPEG/SVG (sharp rasteriza el SVG). Devuelve un data URL PNG con
 *  alpha, o null si no hay logo o si sharp falla (defensive — el PDF cae al
 *  mosaico de solo herramientas). */
export async function buildWatermarkLogo(
  logoDataUrl: string | undefined | null,
): Promise<string | null> {
  const src = logoDataUrl?.trim();
  if (!src || !src.startsWith("data:")) return null;
  const input = dataUrlToBuffer(src);
  if (!input) return null;

  // Logo a 44px dentro de un lienzo de 110px (40%): mismo peso visual que la
  // llave dentro de su celda de 52pt.
  const INNER = 44;
  const CANVAS = 110;
  try {
    const inner = await sharp(input, { failOn: "none" })
      .resize(INNER, INNER, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    const padded = await sharp({
      create: {
        width: CANVAS,
        height: CANVAS,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: inner, gravity: "center" }])
      .png()
      .toBuffer();
    return `data:image/png;base64,${padded.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Procesa un array de `{ dataUrl, ... }` en paralelo. */
export async function shrinkImageList<T extends { dataUrl: string }>(
  items: T[] | undefined | null,
): Promise<T[]> {
  if (!items || items.length === 0) return items ?? [];
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      dataUrl: await shrinkImageForPdf(item.dataUrl),
    })),
  );
}

/** Recorre la sección típica del peritaje (Record<itemId, { images: [...] }>)
 *  y re-comprime todas las fotos. Devuelve una nueva sección — no muta. */
export async function shrinkSectionImages<
  T extends { images?: { dataUrl: string }[] | undefined },
>(section: Record<string, T> | undefined): Promise<Record<string, T>> {
  if (!section) return {};
  const out: Record<string, T> = {};
  await Promise.all(
    Object.entries(section).map(async ([key, entry]) => {
      out[key] = {
        ...entry,
        images: entry.images ? await shrinkImageList(entry.images) : entry.images,
      };
    }),
  );
  return out;
}
