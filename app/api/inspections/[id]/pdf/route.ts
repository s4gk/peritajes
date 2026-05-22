import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import {
  checkInspectionAccess,
  ensureCompletedPdf,
} from "@/lib/server/inspections";
import { readPdf } from "@/lib/server/pdf-storage";
import { buildPublicBaseUrl } from "@/lib/server/qr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sirve el PDF oficial de un peritaje finalizado, leyendo los bytes desde
 * `data/pdfs/{id}.pdf`. Si el peritaje está finalizado pero el archivo aún
 * no existe (p.ej. un finalize previo cuyo render falló), lo intenta generar
 * y persistir en este request.
 *
 * Para borradores (sin locked_at) responde 409 — el endpoint /api/pdf sigue
 * cubriendo previews on-the-fly.
 */
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERROR";
    return NextResponse.json(
      { error: msg === "UNAUTHORIZED" ? "No autenticado" : msg },
      { status: msg === "UNAUTHORIZED" ? 401 : 400 },
    );
  }

  const access = await checkInspectionAccess(params.id, user);
  if (access.kind === "not_found") {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  if (access.kind === "forbidden") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
    const inspection = await ensureCompletedPdf({
      inspectionId: params.id,
      user,
      baseUrl: buildPublicBaseUrl(req) || new URL(req.url).origin,
    });
    const bytes = await readPdf(params.id);
    if (!bytes) {
      return NextResponse.json(
        { error: "PDF no disponible" },
        { status: 500 },
      );
    }
    const slug = (inspection.data.vehicle.plate || "inspeccion").replace(
      /[^A-Z0-9]/gi,
      "",
    );
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="peritaje-${slug}.pdf"`,
        "cache-control": "no-store",
        "content-length": String(bytes.length),
        // Hash incluido en el header para que clientes que verifiquen
        // integridad puedan compararlo contra el sha256 reportado en DB.
        ...(inspection.pdfSha256
          ? { "x-pdf-sha256": inspection.pdfSha256 }
          : {}),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    if (msg === "INSPECTION_NOT_FINALIZED") {
      return NextResponse.json(
        { error: "El peritaje aún es borrador. Finalízalo antes de descargar." },
        { status: 409 },
      );
    }
    if (msg === "INSPECTION_NOT_FOUND") {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    return NextResponse.json(
      { error: `Error al generar PDF: ${msg}` },
      { status: 500 },
    );
  }
}
