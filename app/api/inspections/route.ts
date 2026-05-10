import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/server/auth";
import {
  createInspectionServer,
  listInspectionsServer,
} from "@/lib/server/inspections";
import type { InspectionData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap defensivo: una inspección con todas las fotos bajo 1600px ronda los
// ~3-4MB; 12MB es el techo razonable antes de rechazar para no atragantar el
// event loop con un JSON.stringify gigante.
const MAX_DATA_BYTES = 12 * 1024 * 1024;

const InspectionPostSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{6,32}$/).optional(),
  data: z.record(z.unknown()).refine((d) => !!d && typeof d === "object", {
    message: "data debe ser un objeto",
  }),
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
    await requireUser();
    const items = await listInspectionsServer();
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
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = InspectionPostSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Cuerpo inválido: falta data u id mal formado." },
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
  );
  return NextResponse.json({ inspection: created });
}
