import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/server/auth";
import { createResetToken } from "@/lib/server/password-reset";
import { buildPublicBaseUrl } from "@/lib/server/qr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauth(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (msg === "FORBIDDEN")
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (e) {
    return unauth(e);
  }
  try {
    const info = await createResetToken(params.id, admin.id);
    const base = buildPublicBaseUrl(req);
    const url = base ? `${base}/reset/${info.token}` : `/reset/${info.token}`;
    return NextResponse.json({
      token: info.token,
      url,
      expiresAt: info.expiresAt,
      user: {
        id: info.userId,
        fullName: info.fullName,
        username: info.username,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
