import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import {
  checkInspectionAccess,
  getInspectionServer,
} from "@/lib/server/inspections";
import { renderInspectionPdf } from "@/lib/server/pdf-render";
import { buildPublicBaseUrl } from "@/lib/server/qr";
import {
  createShareToken,
  getActiveShareTokenForInspection,
} from "@/lib/server/share-tokens";
import { type RiskReport } from "@/lib/rules-engine";
import { type PdfMode } from "@/lib/pdf-template";
import type { InspectionData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Payload = {
  data: InspectionData;
  report?: RiskReport;
  mode?: PdfMode;
  /** ID del peritaje en DB. Necesario para amarrar el PDF a un share token y
   *  embeber el QR de verificación. Si no se manda, el PDF sale sin QR. */
  inspectionId?: string;
};

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return new NextResponse("No autenticado", { status: 401 });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return new NextResponse("Cuerpo inválido", { status: 400 });
  }

  if (!body?.data?.vehicle) {
    return new NextResponse("Datos de inspección faltantes", { status: 400 });
  }

  let verificationUrl: string | null = null;
  let reportNumber: string | null = null;
  if (body.inspectionId) {
    // Antes de tocar share tokens hay que confirmar que el user es dueño
    // (o admin) del peritaje. Sin esto, un perito podía generar tokens
    // públicos sobre peritajes de otros mandando inspectionId arbitrario.
    const access = await checkInspectionAccess(body.inspectionId, user);
    if (access.kind === "forbidden") {
      return new NextResponse("Sin permisos", { status: 403 });
    }
    if (access.kind === "ok") {
      // Traemos el consecutivo oficial si ya está asignado. Para borradores
      // (sin reportNumber) el PDF cae al docNumber derivado de placa+fecha.
      try {
        const stored = await getInspectionServer(body.inspectionId);
        reportNumber = stored?.reportNumber ?? null;
      } catch {
        reportNumber = null;
      }
      try {
        let token = await getActiveShareTokenForInspection(body.inspectionId);
        if (!token) {
          token = await createShareToken({
            inspectionId: body.inspectionId,
            createdBy: user.id,
          });
        }
        const base = buildPublicBaseUrl(req);
        verificationUrl = base ? `${base}/r/${token.token}` : `/r/${token.token}`;
      } catch {
        // Si falla la creación del token, el PDF sale sin QR. No bloqueamos al
        // perito que solo quiere descargar.
        verificationUrl = null;
      }
    }
    // Si access.kind === "not_found" simplemente seguimos sin QR (puede ser
    // un peritaje aún no sincronizado al server).
  }

  try {
    const { buffer, plateSlug } = await renderInspectionPdf({
      data: body.data,
      report: body.report,
      mode: body.mode,
      verificationUrl,
      reportNumber,
    });
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="peritaje-${plateSlug}.pdf"`,
        "cache-control": "no-store",
        "content-length": String(buffer.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return new NextResponse(`Error al generar PDF: ${message}`, { status: 500 });
  }
}
