import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { checkInspectionAccess } from "@/lib/server/inspections";
import { getShareToken, revokeShareToken } from "@/lib/server/share-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/share/[token]
 * Revoca un token de compartido. Sólo el dueño del peritaje (o admin) puede
 * revocar — sin esto cualquier perito autenticado podía tumbar links de otros.
 */
export async function DELETE(_req: Request, ctx: { params: { token: string } }) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "no_auth" }, { status: 401 });
  }
  const token = ctx.params.token;
  if (!token) return NextResponse.json({ error: "missing_token" }, { status: 400 });

  const share = await getShareToken(token);
  if (!share) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const access = await checkInspectionAccess(share.inspectionId, user);
  if (access.kind === "not_found") {
    return NextResponse.json({ error: "inspection_not_found" }, { status: 404 });
  }
  if (access.kind === "forbidden") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await revokeShareToken(token);
  return NextResponse.json({ ok: true });
}
