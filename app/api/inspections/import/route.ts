import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { importInspectionsServer } from "@/lib/server/inspections";
import type { StoredInspection } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKUP_VERSION = 1;

type BackupPayload = {
  version?: number;
  inspections?: StoredInspection[];
};

function unauth(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (msg === "FORBIDDEN")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  if (user.role === "employee") {
    return NextResponse.json(
      { error: "Solo el dueño puede importar peritajes." },
      { status: 403 },
    );
  }

  let body: BackupPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!body || !Array.isArray(body.inspections)) {
    return NextResponse.json(
      { error: "Archivo no parece ser un backup de Perito." },
      { status: 400 },
    );
  }
  if (body.version !== BACKUP_VERSION) {
    return NextResponse.json(
      { error: `Versión de backup no soportada (${body.version}).` },
      { status: 400 },
    );
  }

  const result = await importInspectionsServer(
    body.inspections,
    user.id,
    user.orgId,
  );
  return NextResponse.json(result);
}
