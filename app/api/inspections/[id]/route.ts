import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin, requireUser } from "@/lib/server/auth";
import {
  deleteInspectionServer,
  getInspectionForUser,
  updateInspectionForUser,
} from "@/lib/server/inspections";
import type { InspectionData } from "@/lib/types";

const MAX_DATA_BYTES = 12 * 1024 * 1024;

const InspectionPutSchema = z.object({
  data: z.record(z.unknown()),
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
  return NextResponse.json({ inspection: result.inspection });
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
