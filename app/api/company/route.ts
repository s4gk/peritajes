import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import {
  getCompanyConfig,
  updateCompanyConfig,
} from "@/lib/server/company";
import { logAudit } from "@/lib/server/db";

export const runtime = "nodejs";

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
    return NextResponse.json(await getCompanyConfig(user.orgId));
  } catch (e) {
    return unauth(e);
  }
}

export async function PUT(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  // Employees no configuran el negocio — esa decisión es del owner.
  if (user.role === "employee") {
    return NextResponse.json(
      { error: "Solo el dueño puede editar la empresa." },
      { status: 403 },
    );
  }
  if (!user.orgId) {
    return NextResponse.json(
      {
        error:
          "El admin no tiene config propia. Cambiá los datos desde la org del cliente.",
      },
      { status: 400 },
    );
  }
  try {
    const body = await req.json();
    const updated = await updateCompanyConfig(user.orgId, body);
    await logAudit(user.id, "company.updated");
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
