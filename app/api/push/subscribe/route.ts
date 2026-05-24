import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { deleteSubscription, saveSubscription } from "@/lib/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

/** Body: { endpoint, keys: { p256dh, auth } } — formato de PushSubscription. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const endpoint = String(body?.endpoint ?? "");
    const p256dh = String(body?.keys?.p256dh ?? "");
    const auth = String(body?.keys?.auth ?? "");
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { error: "Falta endpoint / keys.p256dh / keys.auth" },
        { status: 400 },
      );
    }
    await saveSubscription({
      userId: user.id,
      endpoint,
      p256dh,
      auth,
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

/** Body: { endpoint }. Llamado cuando el user revoca permisos o desinstala. */
export async function DELETE(req: Request) {
  try {
    await requireUser();
    const body = await req.json().catch(() => ({}));
    const endpoint = String(body?.endpoint ?? "");
    if (!endpoint) {
      return NextResponse.json({ error: "Falta endpoint" }, { status: 400 });
    }
    await deleteSubscription(endpoint);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
