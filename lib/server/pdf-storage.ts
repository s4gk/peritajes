import "server-only";

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Almacena en disco el PDF "oficial" de los peritajes finalizados. Una vez
 * que el peritaje queda locked, el archivo en `data/pdfs/{id}.pdf` es la
 * única copia entregable — el sha256 vive en la fila de la inspección para
 * verificar integridad.
 */

const PDF_ROOT = path.join(process.cwd(), "data", "pdfs");

function pdfPathForId(id: string): string {
  // Defensa básica contra path traversal. Los IDs los generamos nosotros
  // (crypto.randomBytes(12).toString("base64url") o similar) así que en la
  // práctica no llegan caracteres raros, pero validamos por si acaso.
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) {
    throw new Error(`ID de peritaje inválido para storage: ${id}`);
  }
  return path.join(PDF_ROOT, `${id}.pdf`);
}

export type StoredPdfMeta = {
  /** Path relativo al root del proyecto, para guardarlo en DB. */
  relativePath: string;
  sha256: string;
  size: number;
};

export async function savePdf(id: string, bytes: Buffer): Promise<StoredPdfMeta> {
  await fs.mkdir(PDF_ROOT, { recursive: true });
  const target = pdfPathForId(id);
  // Escribimos a un temp y renombramos atomicamente — evita PDFs truncados
  // si el proceso muere a mitad de write.
  const tmp = `${target}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, bytes, { mode: 0o600 });
  await fs.rename(tmp, target);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  return {
    relativePath: path.relative(process.cwd(), target),
    sha256,
    size: bytes.length,
  };
}

/**
 * ¿Está el archivo realmente en disco? La fila en DB puede tener pdf_path y
 * pdf_sha256 y aun así no haber archivo (borrado manual, restore de backup de
 * la DB sin los archivos, disco reemplazado). Sin este chequeo la descarga
 * queda rota para siempre porque ensureCompletedPdf corta antes de regenerar.
 */
export async function pdfExists(id: string): Promise<boolean> {
  try {
    await fs.stat(pdfPathForId(id));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export async function readPdf(id: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(pdfPathForId(id));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function deletePdf(id: string): Promise<void> {
  try {
    await fs.unlink(pdfPathForId(id));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export async function verifyPdfIntegrity(
  id: string,
  expectedSha256: string,
): Promise<{ ok: boolean; bytes: Buffer | null }> {
  const bytes = await readPdf(id);
  if (!bytes) return { ok: false, bytes: null };
  const actual = crypto.createHash("sha256").update(bytes).digest("hex");
  return { ok: actual === expectedSha256, bytes };
}
