import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import {
  checkInspectionAccess,
  ensureCompletedPdf,
  getInspectionServer,
} from "@/lib/server/inspections";
import { readPdf } from "@/lib/server/pdf-storage";
import { buildPublicBaseUrl } from "@/lib/server/qr";
import {
  createShareToken,
  getActiveShareTokenForInspection,
} from "@/lib/server/share-tokens";
import { resolveWaOrgId } from "@/lib/server/whatsapp-meta";
import { notifyClientFinalPdf } from "@/lib/server/whatsapp-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reenvía el PDF oficial al teléfono del propietario via WhatsApp. Disparado
 * desde el wizard cuando el cliente reporta que no le llegó, o cuando el
 * envío automático tras finalizar falló.
 *
 * Requisitos:
 *  - El peritaje debe estar finalizado (`lockedAt`).
 *  - Debe haber `ownerPhone` cargado.
 *  - El user que pide el reenvío debe tener acceso al peritaje.
 *
 * Usa `manualResend: true` en `notifyClientFinalPdf` para saltarse el dedup
 * de 10min del envío original. El nuevo envío queda igual auditado en
 * `audit_log` como un evento `wa.delivery` separado, así el wizard puede
 * mostrar la línea de tiempo "enviado · reenviado · reenviado".
 */
export async function POST(
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

  const stored = await getInspectionServer(params.id);
  if (!stored) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  if (!stored.lockedAt) {
    return NextResponse.json(
      { error: "El peritaje debe estar finalizado antes de reenviar el PDF." },
      { status: 409 },
    );
  }
  const phone = stored.data.vehicle?.ownerPhone?.trim();
  if (!phone) {
    return NextResponse.json(
      {
        error:
          "El propietario no tiene teléfono cargado. Edita los datos del vehículo antes de reenviar.",
      },
      { status: 422 },
    );
  }

  // Aseguramos que exista el PDF (si el render inicial falló, se reintenta acá).
  try {
    await ensureCompletedPdf({
      inspectionId: params.id,
      user,
      baseUrl: buildPublicBaseUrl(req) || new URL(req.url).origin,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `No se pudo preparar el PDF: ${(err as Error).message}` },
      { status: 500 },
    );
  }
  const pdfBuffer = await readPdf(params.id);
  if (!pdfBuffer) {
    return NextResponse.json(
      { error: "PDF no disponible" },
      { status: 500 },
    );
  }

  // URL pública del PDF (link `/r/{token}`) — Twilio la usa como media; Meta
  // la ignora. Best-effort: si falla, el envío sigue (Meta no la necesita).
  let pdfPublicUrl: string | null = null;
  try {
    const base = buildPublicBaseUrl(req) || new URL(req.url).origin;
    const existing = await getActiveShareTokenForInspection(params.id);
    const token = existing
      ? existing.token
      : (await createShareToken({ inspectionId: params.id, createdBy: user.id }))
          .token;
    pdfPublicUrl = `${base.replace(/\/$/, "")}/r/${token}`;
  } catch (err) {
    console.error(
      "[resend-pdf] no se pudo generar URL pública del PDF:",
      (err as Error).message,
    );
  }

  notifyClientFinalPdf({
    clientPhone: phone,
    ownerName: stored.data.vehicle?.owner ?? "",
    plate: stored.data.vehicle?.plate ?? "",
    reportNumber: stored.reportNumber ?? null,
    pdfBuffer,
    pdfPublicUrl,
    orgId: resolveWaOrgId(user, stored.orgId ?? null),
    inspectionId: stored.id,
    manualResend: true,
  });

  return NextResponse.json({ ok: true });
}
