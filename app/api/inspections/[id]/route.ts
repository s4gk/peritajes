import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import {
  deleteInspectionServer,
  getInspectionServer,
  updateInspectionServer,
} from "@/lib/server/inspections";
import type { InspectionData } from "@/lib/types";

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
  try {
    await requireUser();
  } catch (e) {
    return unauth(e);
  }
  const item = await getInspectionServer(params.id);
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
  let body: { data?: InspectionData };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.data) {
    return NextResponse.json(
      { error: "Falta el campo 'data'" },
      { status: 400 },
    );
  }
  const updated = await updateInspectionServer(params.id, body.data, user.id);
  if (!updated) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  return NextResponse.json({ inspection: updated });
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
  const ok = await deleteInspectionServer(params.id, user.id);
  if (!ok) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
