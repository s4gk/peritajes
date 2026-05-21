import { NextResponse } from "next/server";
import { z } from "zod";

import { InspectionDataSchema } from "@/lib/inspection-schema";
import { requireAdmin, requireUser } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import {
  deleteInspectionServer,
  getInspectionForUser,
  updateInspectionForUser,
} from "@/lib/server/inspections";
import { renderInspectionPdf } from "@/lib/server/pdf-render";
import {
  createShareToken,
  getActiveShareTokenForInspection,
} from "@/lib/server/share-tokens";
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
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = InspectionPutSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Falta el campo 'data'" },
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
  // Snapshot del estado previo para detectar la transición a "completed".
  // Necesario para que la notificación WhatsApp dispare solo la primera vez —
  // sin esto, cada autosave de un peritaje ya completado mandaría el PDF de
  // nuevo al cliente.
  let previousStatus: string | null = null;
  try {
    const prev = await query<{ status: string }>(
      "SELECT status FROM inspections WHERE id = $1",
      [params.id],
    );
    previousStatus = prev.rows[0]?.status ?? null;
  } catch {
    /* si falla la query, igual seguimos: la notificación se salta */
  }

  const result = await updateInspectionForUser(
    params.id,
    parsed.data.data as unknown as InspectionData,
    user,
  );
  if (result.forbidden) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!result.inspection) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  // Fire-and-forget: si el peritaje pasó de no-completed a completed con
  // firma del cliente presente, mandamos avisos por WhatsApp. Lo hacemos
  // fuera del ciclo de respuesta para no bloquear al wizard.
  const inspection = result.inspection;
  const justCompleted =
    previousStatus !== "completed" &&
    inspection.data.status === "completed" &&
    Boolean(inspection.data.conclusion?.clientSignature);
  if (justCompleted) {
    void sendCompletionNotifications(inspection, user.id, req).catch((err) => {
      console.error(
        "[inspections] post-firma notifications failed:",
        (err as Error).message,
      );
    });
  }

  return NextResponse.json({ inspection: result.inspection });
}

/**
 * Renderiza el PDF del peritaje y dispara las notificaciones de WhatsApp
 * (equipo + PDF al cliente). Corre fuera del ciclo de respuesta para no
 * bloquear al wizard. Cualquier error se logguea y se traga — la firma del
 * cliente ya quedó persistida y eso es lo importante.
 */
async function sendCompletionNotifications(
  inspection: StoredInspection,
  userId: string,
  req: Request,
): Promise<void> {
  const data = inspection.data;
  const vehicle = data.vehicle;

  // Aviso al equipo (texto liviano — no espera el render del PDF).
  await notifyTeamSignatureCompleted({
    inspectionId: inspection.id,
    plate: vehicle?.plate ?? "",
    owner: vehicle?.owner ?? "",
  }).catch((err) => {
    console.error("[wa] team-signed failed:", (err as Error).message);
  });

  // PDF al cliente: solo si tenemos teléfono. Si no, igual el peritaje queda
  // disponible para descargar manualmente desde el panel.
  if (!vehicle?.ownerPhone?.trim()) return;

  // Reutilizamos un share token activo o creamos uno nuevo para que el QR
  // del PDF apunte a la versión pública verificable. Si esto falla, el PDF
  // sale sin QR — preferimos eso a no mandar nada.
  let verificationUrl: string | null = null;
  try {
    let token = await getActiveShareTokenForInspection(inspection.id);
    if (!token) {
      token = await createShareToken({
        inspectionId: inspection.id,
        createdBy: userId,
      });
    }
    const base = process.env.APP_PUBLIC_URL?.trim().replace(/\/$/, "")
      || new URL(req.url).origin;
    verificationUrl = `${base}/r/${token.token}`;
  } catch {
    verificationUrl = null;
  }

  const { buffer } = await renderInspectionPdf({
    data,
    verificationUrl,
    reportNumber: inspection.reportNumber ?? null,
  });

  notifyClientFinalPdf({
    clientPhone: vehicle.ownerPhone,
    ownerName: vehicle.owner ?? "",
    plate: vehicle.plate ?? "",
    reportNumber: inspection.reportNumber ?? null,
    pdfBuffer: buffer,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  let user;
  try {
    user = await requireAdmin();
  } catch (e) {
    return unauth(e);
  }
  const ok = await deleteInspectionServer(params.id, user.id);
  if (!ok) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
