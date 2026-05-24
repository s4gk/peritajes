import { NextResponse } from "next/server";
import { z } from "zod";

import { InspectionDataSchema } from "@/lib/inspection-schema";
import { requireUser } from "@/lib/server/auth";
import {
  createInspectionServer,
  listInspectionsFor,
} from "@/lib/server/inspections";
import { upsertVehicleOwner } from "@/lib/server/vehicle-owners";
import { notifyTeamNewIntake } from "@/lib/server/whatsapp-notifications";
import type { InspectionData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap defensivo: una inspección con todas las fotos bajo 1600px ronda los
// ~3-4MB; 12MB es el techo razonable antes de rechazar para no atragantar el
// event loop con un JSON.stringify gigante.
const MAX_DATA_BYTES = 12 * 1024 * 1024;

const InspectionPostSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{6,32}$/).optional(),
  data: InspectionDataSchema,
});

function unauth(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (msg === "FORBIDDEN")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function GET() {
  try {
    const user = await requireUser();
    const items = await listInspectionsFor(user);
    return NextResponse.json({ inspections: items });
  } catch (e) {
    return unauth(e);
  }
}

export async function POST(req: Request) {
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
    // Diferenciamos entre JSON mal formado (cliente buggy) y body vacío
    // (request truncado / abortado por el cliente). Saber qué pasó ayuda en
    // diagnóstico — antes devolvíamos "JSON inválido" para todo.
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "JSON inválido", detail: message.slice(0, 200) },
      { status: 400 },
    );
  }
  const parsed = InspectionPostSchema.safeParse(raw);
  if (!parsed.success) {
    // Exponemos la primera issue del schema en `detail` para que el cliente
    // sepa qué campo tiene problema (sin filtrar info sensible — los issues
    // son sobre nuestro propio schema).
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: "Cuerpo inválido: falta data u id mal formado.",
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
  const created = await createInspectionServer(
    parsed.data.data as unknown as InspectionData,
    user.id,
    parsed.data.id,
    // Admin sin org_id crea peritajes "sueltos" (sin tenant). En la práctica
    // admin no debería crear peritajes — está para soporte/auditoría — pero
    // si lo hace, queda como cross-org y solo lo ve admin.
    user.orgId,
  );
  // Fire-and-forget: notificar al equipo por WhatsApp. Si WA no está
  // conectado, la cola interna se encarga; si falla, solo logueamos.
  const vehicle = created.data.vehicle;
  void notifyTeamNewIntake({
    inspectionId: created.id,
    plate: vehicle?.plate ?? "",
    vehicle: [vehicle?.make, vehicle?.model, vehicle?.year]
      .filter((v) => v && v.trim())
      .join(" "),
    owner: vehicle?.owner ?? "",
    inspectorName: user.fullName,
    orgId: created.orgId ?? user.orgId,
  }).catch((err) => {
    console.error("[inspections] notify team failed:", (err as Error).message);
  });
  // Fire-and-forget: registrar / actualizar el propietario en vehicle_owners.
  // No incrementamos inspections_count al crear (está en draft); se incrementa
  // recién cuando el peritaje se finaliza (PUT con justLocked).
  if (vehicle) {
    void upsertVehicleOwner({
      orgId: created.orgId ?? user.orgId,
      fullName: vehicle.owner ?? "",
      document: vehicle.ownerDocument ?? "",
      phone: vehicle.ownerPhone ?? "",
      createdBy: user.id,
      incrementInspections: false,
    }).catch((err) => {
      console.error("[owners] upsert (POST) failed:", (err as Error).message);
    });
  }
  return NextResponse.json({ inspection: created });
}
