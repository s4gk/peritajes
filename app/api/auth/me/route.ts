import { NextResponse } from "next/server";

import {
  getCurrentUser,
  getUserById,
  setUserPassword,
  updateUserProfile,
} from "@/lib/server/auth";
import { ensureCsrfCookie } from "@/lib/server/csrf";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  // Para sesiones que vienen de antes de que existiera CSRF, emitimos la
  // cookie acá. El panel hace fetch a /me en el primer load, así que el
  // primer state-changing request ya tendrá el token disponible.
  ensureCsrfCookie();
  return NextResponse.json({ user });
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  try {
    const body = await req.json();
    if (typeof body.password === "string") {
      await setUserPassword(user.id, body.password);
    }
    const profilePatch: Parameters<typeof updateUserProfile>[1] = {};
    if (typeof body.fullName === "string") profilePatch.fullName = body.fullName;
    if (typeof body.email === "string" || body.email === null)
      profilePatch.email = body.email;
    if (typeof body.licenseId === "string" || body.licenseId === null)
      profilePatch.licenseId = body.licenseId;
    if (typeof body.signatureDataUrl === "string" || body.signatureDataUrl === null)
      profilePatch.signatureDataUrl = body.signatureDataUrl;
    if (typeof body.waPhone === "string" || body.waPhone === null)
      profilePatch.waPhone = body.waPhone;
    if (Object.keys(profilePatch).length > 0) {
      await updateUserProfile(user.id, profilePatch);
    }
    const fresh = await getUserById(user.id);
    return NextResponse.json({ ok: true, user: fresh });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
