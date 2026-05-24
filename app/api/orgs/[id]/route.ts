import { NextResponse } from "next/server";

import { listUsersFor, requireAdmin } from "@/lib/server/auth";
import {
  deleteOrganization,
  getOrgStats,
  getOrgSummary,
  setOrganizationActive,
} from "@/lib/server/orgs";

export const runtime = "nodejs";

function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (msg === "FORBIDDEN")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

/**
 * Detalle de una organización para el panel admin. Devuelve la org +
 * todos los users que pertenecen a ella (owner + employees). Solo admin.
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const actor = await requireAdmin();
    const org = await getOrgSummary(ctx.params.id);
    if (!org) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    }
    // listUsersFor(actor=admin) trae a todos; filtramos por org_id.
    const allUsers = await listUsersFor(actor);
    const members = allUsers.filter((u) => u.orgId === org.id);
    const stats = await getOrgStats(org.id);
    return NextResponse.json({ org, members, stats });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Suspender o reactivar una empresa. Body: { active: boolean }. Solo admin.
 * Al suspender, todas las sesiones activas de la org se invalidan: el owner
 * y sus empleados son expulsados al próximo request.
 */
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  try {
    const actor = await requireAdmin();
    const body = await req.json();
    if (typeof body?.active !== "boolean") {
      return NextResponse.json(
        { error: "Falta el campo 'active' (boolean)." },
        { status: 400 },
      );
    }
    await setOrganizationActive(ctx.params.id, body.active, actor.id);
    const org = await getOrgSummary(ctx.params.id);
    return NextResponse.json({ org });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Eliminar permanentemente la empresa, sus users y datos asociados. Solo
 * admin. Las inspections y appointments quedan como huérfanas (org_id NULL)
 * para que admin las siga pudiendo auditar — esto es por el FK ON DELETE
 * SET NULL.
 */
export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  try {
    const actor = await requireAdmin();
    await deleteOrganization(ctx.params.id, actor.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
