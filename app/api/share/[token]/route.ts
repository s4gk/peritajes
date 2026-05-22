import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { checkInspectionAccess } from "@/lib/server/inspections";
import { getShareToken, revokeShareToken } from "@/lib/server/share-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/share/[token]
 * Revoca un token de compartido. Política del 2026-05: SOLO admin puede
 * revocar. Un link de PDF entregado al cliente es un commitment — owners
 * no pueden tumbarlo unilateralmente (puede haber un cliente esperando
 * acceder al link). Si necesitan invalidar uno, contactan a soporte.
 */
export async function DELETE(_req: Request, ctx: { params: { token: string } }) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "no_auth" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json(
      {
        error:
          "Solo el administrador puede revocar enlaces de PDF públicos.",
      },
      { status: 403 },
    );
  }
  const token = ctx.params.token;
  if (!token) return NextResponse.json({ error: "missing_token" }, { status: 400 });

  const share = await getShareToken(token);
  if (!share) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Aún siendo admin verificamos que la inspección exista (defensa en
  // profundidad — share token huérfano no debería existir, pero por si).
  const access = await checkInspectionAccess(share.inspectionId, user);
  if (access.kind === "not_found") {
    return NextResponse.json({ error: "inspection_not_found" }, { status: 404 });
  }

  await revokeShareToken(token);
  return NextResponse.json({ ok: true });
}
