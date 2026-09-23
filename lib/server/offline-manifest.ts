import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Lista de URLs que el service worker precachea para que la app funcione sin
 * red aunque el perito nunca haya abierto una pantalla con esta versión:
 *   - todos los assets de `.next/static` del build actual (JS/CSS/fuentes; con
 *     hash, inmutables — pesan ~2 MB en total).
 * El OCR local va aparte (ver lib/ocr-assets.ts): tiene su propio cache.
 *
 * Se lee del disco en cada request (es barato y así siempre corresponde al
 * build que está sirviendo el proceso).
 */
export async function listOfflineAssets(rootDir: string = process.cwd()): Promise<string[]> {
  const out: string[] = [];
  const staticDir = path.join(rootDir, ".next", "static");
  for (const rel of await walk(staticDir)) {
    if (rel.endsWith(".map")) continue;
    out.push(`/_next/static/${encodeAssetPath(rel)}`);
  }
  return out.sort();
}

/**
 * Codifica la ruta igual que la pide el navegador. Importa porque la Cache
 * API compara URLs textualmente: Next referencia el chunk de
 * `app/(panel)/inspection/[id]/page.js` como `.../%5Bid%5D/page.js`, y si lo
 * cacheáramos con corchetes literales el wizard no lo encontraría sin red.
 */
export function encodeAssetPath(rel: string): string {
  return rel
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

async function walk(dir: string, prefix = ""): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) files.push(...(await walk(path.join(dir, e.name), rel)));
    else if (e.isFile()) files.push(rel.split(path.sep).join("/"));
  }
  return files;
}
