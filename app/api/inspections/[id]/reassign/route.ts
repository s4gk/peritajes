import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserById, requireUser } from "@/lib/server/auth";
import { logAudit, query } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ReassignSchema = z.object({
  newUserId: z.string().min(1),
});

function unauth(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (msg === "FORBIDDEN")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

/**
 * Reasigna un peritaje a otro usuario.
 *
 * Reglas:
 *   - admin: puede mover cualquier peritaje a cualquier usuario.
 *   - owner: puede mover SUS peritajes (de su org) a OTRO usuario de su org.
 *            No puede sacar peritajes de su org ni traer de fuera.
 *   - employee: 403. No tiene permiso para reasignar — el owner administra.
 *   - Peritaje finalizado (locked_at): NO se reasigna. El documento ya fue
 *     entregado al cliente; cambiar el creador retroactivamente alteraría
 *     la auditoría. Si por alguna razón hay que corregir, lo hace admin
 *     directo en DB.
 *
 * Devuelve la fila actualizada para que el cliente refresque su cache.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  let actor;
  try {
    actor = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  if (actor.role === "employee") {
    return NextResponse.json(
      { error: "Solo el dueño puede reasignar peritajes." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = ReassignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Falta newUserId." },
      { status: 400 },
    );
  }

  // Inspección existe?
  const inspection = await query<{
    id: string;
    user_id: string | null;
    org_id: string | null;
    locked_at: Date | string | null;
    status: string;
  }>(
    "SELECT id, user_id, org_id, locked_at, status FROM inspections WHERE id = $1",
    [params.id],
  );
  if (inspection.rowCount === 0) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  const row = inspection.rows[0];

  // Scope: owner solo mueve dentro de su org.
  if (actor.role === "owner" && row.org_id !== actor.orgId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  // Lock: peritaje finalizado es inmutable.
  if (row.locked_at !== null || row.status === "completed") {
    return NextResponse.json(
      {
        error:
          "El peritaje está finalizado y no puede reasignarse. Contactá al admin.",
      },
      { status: 423 },
    );
  }

  // Validamos el destinatario.
  const target = await getUserById(parsed.data.newUserId);
  if (!target) {
    return NextResponse.json(
      { error: "Usuario destino no existe." },
      { status: 404 },
    );
  }
  if (!target.active) {
    return NextResponse.json(
      { error: "El usuario destino está desactivado." },
      { status: 400 },
    );
  }
  if (actor.role === "owner" && target.orgId !== actor.orgId) {
    return NextResponse.json(
      { error: "Solo podés reasignar a usuarios de tu propio negocio." },
      { status: 403 },
    );
  }

  await query(
    `UPDATE inspections
     SET user_id = $1,
         updated_at = now()
     WHERE id = $2`,
    [target.id, params.id],
  );
  await logAudit(
    actor.id,
    "inspection.reassigned",
    JSON.stringify({
      inspectionId: params.id,
      from: row.user_id,
      to: target.id,
    }),
  );

  return NextResponse.json({ ok: true, newUserId: target.id });
}
