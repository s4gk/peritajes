import { NextResponse } from "next/server";

import { createSession, type SignSessionContext } from "@/lib/sign-sessions";
import { notifyClientSignLink } from "@/lib/server/whatsapp-notifications";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { context?: SignSessionContext; clientPhone?: string | null } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const context = body.context ?? {};
  const session = await createSession(context);
  // Fire-and-forget: si el cliente nos dio su teléfono, le mandamos el link
  // por WhatsApp. NO guardamos el phone en la sesión (es transitorio) y los
  // fallos no rompen la creación del QR.
  if (body.clientPhone && body.clientPhone.trim()) {
    notifyClientSignLink({
      clientPhone: body.clientPhone,
      ownerName: context.owner ?? "",
      plate: context.plate ?? "",
      signToken: session.token,
    });
  }
  return NextResponse.json({
    token: session.token,
    expiresAt: session.expiresAt,
  });
}
