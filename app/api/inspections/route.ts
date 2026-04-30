import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import {
  createInspectionServer,
  listInspectionsServer,
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
  let body: { id?: string; data?: InspectionData };
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
  const created = await createInspectionServer(body.data, user.id, body.id);
  return NextResponse.json({ inspection: created });
}
