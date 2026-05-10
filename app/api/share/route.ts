import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/server/auth";
import { checkInspectionAccess } from "@/lib/server/inspections";
import {
  createShareToken,
  getActiveShareTokenForInspection,
} from "@/lib/server/share-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SharePostSchema = z.object({
  inspectionId: z.string().min(1).max(64),
  force: z.boolean().optional(),
});

/**
 * GET /api/share?inspectionId=...
 * Devuelve el token activo (si existe) sin crear uno nuevo. Lo usa la UI del
 * summary para saber si ya hay un link compartido cuando el perito vuelve.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "no_auth" }, { status: 401 });
  }
  const url = new URL(req.url);
  const inspectionId = url.searchParams.get("inspectionId")?.trim();
  if (!inspectionId) {
    return NextResponse.json({ error: "missing_inspection_id" }, { status: 400 });
  }
  const access = await checkInspectionAccess(inspectionId, user);
  if (access.kind === "not_found") {
    return NextResponse.json({ error: "inspection_not_found" }, { status: 404 });
  }
  if (access.kind === "forbidden") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const token = await getActiveShareTokenForInspection(inspectionId);
  if (!token) return NextResponse.json({ token: null });
  return NextResponse.json({
    token: token.token,
    url: `/r/${token.token}`,
    expiresAt: token.expiresAt,
    accessCount: token.accessCount,
    lastAccessedAt: token.lastAccessedAt,
  });
}

/**
 * POST /api/share
 * Body: { inspectionId: string, force?: boolean }
 * Returns: { token, url, expiresAt, accessCount }
 *
 * Si la inspección ya tiene un token vivo (no revocado, no expirado), lo
 * devuelve en vez de generar uno nuevo. Esto evita acumular links zombies por
 * cada vez que el perito toca el botón. Pasar force=true crea uno nuevo igual.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "no_auth" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = SharePostSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const inspectionId = parsed.data.inspectionId.trim();
  if (!inspectionId) {
    return NextResponse.json({ error: "missing_inspection_id" }, { status: 400 });
  }

  // Sólo el dueño (o admin) puede compartir su peritaje.
  const access = await checkInspectionAccess(inspectionId, user);
  if (access.kind === "not_found") {
    return NextResponse.json({ error: "inspection_not_found" }, { status: 404 });
  }
  if (access.kind === "forbidden") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let token = parsed.data.force ? null : await getActiveShareTokenForInspection(inspectionId);
  if (!token) {
    token = await createShareToken({
      inspectionId,
      createdBy: user.id,
    });
  }

  return NextResponse.json({
    token: token.token,
    url: `/r/${token.token}`,
    expiresAt: token.expiresAt,
    accessCount: token.accessCount,
  });
}
