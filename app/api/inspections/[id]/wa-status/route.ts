import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import {
  checkInspectionAccess,
  getInspectionServer,
} from "@/lib/server/inspections";
import { getWhatsAppStatus, resolveWaOrgId } from "@/lib/server/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Devuelve el historial de envíos por WhatsApp asociados al peritaje +
 * estado actual del socket WA de su org. El wizard lo pollea cada 3s después
 * de finalizar para mostrar al perito si el cliente recibió el PDF.
 *
 * Los eventos vienen de `audit_log` (action='wa.delivery'). El JSON detail
 * lleva `{type, inspectionId, phone, status, error?}`. Filtramos en SQL via
 * `detail::jsonb @> '{"inspectionId": "..."}'` para no escanear toda la
 * tabla.
 */
export async function GET(
  _req: Request,
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

  // Necesitamos saber a qué org pertenece el peritaje para reportar el estado
  // del socket WA de esa org (no el del user — pueden diferir si el peritaje
  // se reasignó cross-org en algún momento). Para peritajes huérfanos sin
  // org, si el actor es admin caemos al tenant sentinel del admin para que
  // pueda probar el flow desde su propia sesión.
  const stored = await getInspectionServer(params.id);
  const orgId = resolveWaOrgId(user, stored?.orgId ?? null);

  const rows = await query<{
    id: string;
    created_at: Date;
    detail: string | null;
  }>(
    `SELECT id, created_at, detail
     FROM audit_log
     WHERE action = 'wa.delivery'
       AND detail::jsonb @> $1::jsonb
     ORDER BY created_at DESC
     LIMIT 50`,
    [JSON.stringify({ inspectionId: params.id })],
  );

  type Event = {
    id: string;
    at: string;
    type: string;
    phone: string;
    status: "sent" | "failed" | "dedup";
    error?: string;
  };
  const events: Event[] = [];
  for (const r of rows.rows) {
    if (!r.detail) continue;
    try {
      const parsed = JSON.parse(r.detail) as {
        type?: string;
        phone?: string;
        status?: "sent" | "failed" | "dedup";
        error?: string;
      };
      if (!parsed.type || !parsed.phone || !parsed.status) continue;
      events.push({
        id: String(r.id),
        at: r.created_at.toISOString(),
        type: parsed.type,
        phone: parsed.phone,
        status: parsed.status,
        error: parsed.error,
      });
    } catch {
      // detail no parseable — lo saltamos.
    }
  }

  const wa = orgId ? getWhatsAppStatus(orgId) : null;

  return NextResponse.json({
    socket: wa
      ? {
          status: wa.status,
          phone: wa.phone,
          queueSize: wa.queueSize,
        }
      : { status: "disconnected", phone: null, queueSize: 0 },
    events,
  });
}
