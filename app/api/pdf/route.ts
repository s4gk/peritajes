import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import {
  checkInspectionAccess,
  ensureCompletedPdf,
  getInspectionServer,
} from "@/lib/server/inspections";
import { renderInspectionPdf } from "@/lib/server/pdf-render";
import { readPdf } from "@/lib/server/pdf-storage";
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
  /** Previsualización de borrador: cualquier usuario puede generarlo, pero sale
   *  con marca de agua "PREVISUALIZACIÓN" y SIN QR/consecutivo oficial. */
  preview?: boolean;
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
  // orgId del peritaje en DB cuando exista (admin previsualizando un peritaje
  // de OTRO cliente debe ver el branding del cliente, no el suyo). Si no hay
  // inspectionId o el peritaje no está en server, caemos a user.orgId.
  let renderOrgId: string | null = user.orgId;
  if (body.inspectionId) {
    // Antes de tocar share tokens hay que confirmar que el user es dueño
    // (o admin) del peritaje. Sin esto, un perito podía generar tokens
    // públicos sobre peritajes de otros mandando inspectionId arbitrario.
    const access = await checkInspectionAccess(body.inspectionId, user);
    if (access.kind === "forbidden") {
      return new NextResponse("Sin permisos", { status: 403 });
    }
    if (access.kind === "ok") {
      // Si el peritaje ya está finalizado, devolvemos directamente el PDF
      // stored — es el documento oficial entregable y debe coincidir bit a
      // bit con el sha256 registrado en DB. No re-rendereamos para no
      // introducir divergencias por cambios de branding, fuentes, etc.
      try {
        const stored = await getInspectionServer(body.inspectionId);
        if (stored?.lockedAt) {
          const inspection = await ensureCompletedPdf({
            inspectionId: body.inspectionId,
            user,
            baseUrl: buildPublicBaseUrl(req) || new URL(req.url).origin,
          });
          const bytes = await readPdf(body.inspectionId);
          if (bytes) {
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
                ...(inspection.pdfSha256
                  ? { "x-pdf-sha256": inspection.pdfSha256 }
                  : {}),
              },
            });
          }
        }
        reportNumber = stored?.reportNumber ?? null;
        // Para previews tomamos el orgId del peritaje persistido. Así un
        // admin pre-visualizando el borrador de un cliente ve el branding
        // del cliente, no defaults vacíos.
        if (stored?.orgId) renderOrgId = stored.orgId;
      } catch {
        reportNumber = null;
      }
      // En previsualización NO generamos share token ni QR de verificación:
      // el documento no es oficial, así que no debe tener enlace público.
      if (!body.preview) {
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
    }
    // Si access.kind === "not_found" simplemente seguimos sin QR (puede ser
    // un peritaje aún no sincronizado al server).
  }

  // Gate del PDF de borrador. Si llegamos hasta acá sin haber retornado el PDF
  // stored, el peritaje no está finalizado (o no existe en server). Dos casos:
  //   - preview=true: cualquier usuario puede generarlo, pero sale con marca de
  //     agua "PREVISUALIZACIÓN" y sin QR/consecutivo — no es entregable.
  //   - descarga "oficial" de un borrador: sigue restringida a admin. Sin esto
  //     el perito podía entregar un PDF sin finalizar (saltándose firma del
  //     cliente, consecutivo oficial y entrega automática por WhatsApp).
  if (!body.preview && user.role !== "admin") {
    return new NextResponse(
      "El PDF solo se puede descargar después de finalizar el peritaje.",
      { status: 403 },
    );
  }

  try {
    // Branding del PDF: si el peritaje vive en server, usamos su orgId (el
    // PDF debe llevar la marca del cliente que lo emite, no la del user
    // logueado — relevante cuando admin pre-visualiza). Fallback: user.orgId.
    const { buffer, plateSlug } = await renderInspectionPdf({
      data: body.data,
      report: body.report,
      mode: body.mode,
      verificationUrl,
      reportNumber,
      orgId: renderOrgId,
      preview: body.preview ?? false,
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
