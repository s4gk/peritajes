import { NextResponse } from "next/server";
import { z } from "zod";

import { InspectionDataSchema } from "@/lib/inspection-schema";
import { requireUser } from "@/lib/server/auth";
import {
  deleteInspectionForUser,
  ensureCompletedPdf,
  getInspectionForUser,
  updateInspectionForUser,
} from "@/lib/server/inspections";
import { readPdf } from "@/lib/server/pdf-storage";
import { buildPublicBaseUrl } from "@/lib/server/qr";
import { upsertVehicleOwner } from "@/lib/server/vehicle-owners";
import { resolveWaOrgId } from "@/lib/server/whatsapp";
import {
  notifyClientFinalPdf,
  notifyTeamSignatureCompleted,
} from "@/lib/server/whatsapp-notifications";
import type { InspectionData, StoredInspection } from "@/lib/types";

const MAX_DATA_BYTES = 12 * 1024 * 1024;

const InspectionPutSchema = z.object({
  data: InspectionDataSchema,
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauth(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (msg === "FORBIDDEN")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  const item = await getInspectionForUser(params.id, user);
  if (!item) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  return NextResponse.json({ inspection: item });
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch (err) {
    return NextResponse.json(
      {
        error: "JSON inválido",
        detail: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      },
      { status: 400 },
    );
  }
  const parsed = InspectionPutSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: "Falta el campo 'data'",
        detail: firstIssue
          ? `${firstIssue.path.join(".") || "(root)"}: ${firstIssue.message}`
          : undefined,
      },
      { status: 400 },
    );
  }
  const dataBytes = JSON.stringify(parsed.data.data).length;
  if (dataBytes > MAX_DATA_BYTES) {
    return NextResponse.json(
      { error: "El peritaje excede el tamaño máximo permitido." },
      { status: 413 },
    );
  }
  const result = await updateInspectionForUser(
    params.id,
    parsed.data.data as unknown as InspectionData,
    user,
  );
  if (result.kind === "forbidden") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (result.kind === "not_found") {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  if (result.kind === "locked") {
    // 423 Locked: el peritaje ya fue finalizado y es inmutable. Devolvemos la
    // versión canónica para que el cliente reemplace su copia local y muestre
    // el modo solo-lectura sin perder los datos.
    return NextResponse.json(
      {
        error: "Peritaje finalizado e inmutable.",
        inspection: result.inspection,
      },
      { status: 423 },
    );
  }
  if (result.kind === "missing_phone") {
    return NextResponse.json(
      {
        error:
          "Falta el teléfono del cliente. No se puede finalizar un peritaje sin celular: el PDF se entrega siempre al cerrar.",
      },
      { status: 422 },
    );
  }

  // result.kind === "ok"
  let inspection = result.inspection;
  // Default: el PDF está OK (no aplica si no acabamos de cerrar). Si el render
  // inline falla pasamos a "pending" — el cliente lo muestra como banner y
  // el GET /api/inspections/[id]/pdf intentará re-renderizar bajo demanda.
  let pdfStatus: "ok" | "not_applicable" | "pending" = result.justLocked
    ? "ok"
    : "not_applicable";
  let pdfError: string | null = null;

  // Si el peritaje acaba de quedar locked, renderizamos y persistimos el PDF
  // antes de devolver la respuesta. Así el archivo entregable existe en disco
  // desde el momento en que el wizard cree que finalizó. Si el render falla
  // (Puppeteer/Gemini), el lock ya está en DB — el PDF se intenta de nuevo
  // bajo demanda desde GET /api/inspections/[id]/pdf.
  if (result.justLocked) {
    try {
      inspection = await ensureCompletedPdf({
        inspectionId: inspection.id,
        user,
        baseUrl: buildPublicBaseUrl(req) || new URL(req.url).origin,
      });
    } catch (err) {
      pdfStatus = "pending";
      pdfError = (err as Error).message;
      console.error("[inspections] ensureCompletedPdf failed:", pdfError);
    }
  }

  // Fire-and-forget: si el peritaje acaba de quedar locked y hay firma del
  // cliente, mandamos avisos por WhatsApp. No bloquea la respuesta. Si el
  // PDF quedó pendiente, `sendCompletionNotifications` intentará renderizarlo
  // de nuevo antes de adjuntarlo.
  if (
    result.justLocked &&
    Boolean(inspection.data.conclusion?.clientSignature)
  ) {
    void sendCompletionNotifications(inspection, user, req).catch((err) => {
      console.error(
        "[inspections] post-firma notifications failed:",
        (err as Error).message,
      );
    });
  }

  // Fire-and-forget: actualizar la ficha del propietario en vehicle_owners.
  // Solo incrementamos inspections_count cuando el peritaje acaba de cerrarse
  // (justLocked), no en cada autosave del wizard.
  const vehicleForOwner = inspection.data.vehicle;
  if (vehicleForOwner) {
    void upsertVehicleOwner({
      orgId: inspection.orgId ?? user.orgId,
      fullName: vehicleForOwner.owner ?? "",
      document: vehicleForOwner.ownerDocument ?? "",
      phone: vehicleForOwner.ownerPhone ?? "",
      createdBy: user.id,
      incrementInspections: result.justLocked,
    }).catch((err) => {
      console.error("[owners] upsert (PUT) failed:", (err as Error).message);
    });
  }

  return NextResponse.json({
    inspection,
    pdfStatus,
    ...(pdfError ? { pdfError } : {}),
  });
}

/**
 * Dispara las notificaciones de WhatsApp post-finalización (aviso al equipo +
 * PDF al cliente). Asume que el PDF ya está persistido en disco — si no, se
 * intenta una recuperación lazy. Corre fuera del ciclo de respuesta principal
 * para no bloquear al wizard; cualquier error se logguea sin afectar el lock.
 */
async function sendCompletionNotifications(
  inspection: StoredInspection,
  user: { id: string; role: string; orgId: string | null },
  req: Request,
): Promise<void> {
  const data = inspection.data;
  const vehicle = data.vehicle;

  const waOrgId = resolveWaOrgId(user, inspection.orgId ?? null);

  await notifyTeamSignatureCompleted({
    inspectionId: inspection.id,
    plate: vehicle?.plate ?? "",
    owner: vehicle?.owner ?? "",
    orgId: waOrgId,
  }).catch((err) => {
    console.error("[wa] team-signed failed:", (err as Error).message);
  });

  if (!vehicle?.ownerPhone?.trim()) return;

  // Intentamos leer el PDF; si no existe (el render inline falló en el PUT),
  // forzamos un nuevo intento aquí. Esto evita que un fallo transitorio de
  // Puppeteer deje al cliente sin su PDF: la notificación corre fuera del
  // ciclo de respuesta, así que reintentar es barato.
  let pdfBuffer = await readPdf(inspection.id);
  if (!pdfBuffer) {
    try {
      await ensureCompletedPdf({
        inspectionId: inspection.id,
        user,
        baseUrl: buildPublicBaseUrl(req) || new URL(req.url).origin,
      });
      pdfBuffer = await readPdf(inspection.id);
    } catch (err) {
      console.error(
        "[wa] client-pdf: render retry falló para",
        inspection.id,
        (err as Error).message,
      );
    }
  }
  if (!pdfBuffer) {
    console.error(
      "[wa] client-pdf: PDF stored no encontrado para",
      inspection.id,
    );
    return;
  }

  notifyClientFinalPdf({
    clientPhone: vehicle.ownerPhone,
    ownerName: vehicle.owner ?? "",
    plate: vehicle.plate ?? "",
    reportNumber: inspection.reportNumber ?? null,
    pdfBuffer,
    orgId: waOrgId,
    inspectionId: inspection.id,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  // Política del 2026-05: SOLO el admin (Vestel) puede eliminar peritajes.
  // Owners y employees no borran nada — si necesitan corregir un dato,
  // editan; si es un peritaje de prueba que quieren limpiar, le piden al
  // admin. Defensa en profundidad: la UI ya esconde el botón a no-admin.
  if (user.role !== "admin") {
    return NextResponse.json(
      {
        error:
          "Solo el administrador puede eliminar peritajes. Si necesitás borrar uno, pedíselo a soporte.",
      },
      { status: 403 },
    );
  }
  const result = await deleteInspectionForUser(params.id, user);
  if (result.kind === "not_found") {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  if (result.kind === "forbidden") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (result.kind === "locked") {
    return NextResponse.json(
      {
        error:
          "El peritaje está finalizado y no puede ser eliminado. Solicítalo a un administrador.",
      },
      { status: 423 },
    );
  }
  return NextResponse.json({ ok: true });
}
