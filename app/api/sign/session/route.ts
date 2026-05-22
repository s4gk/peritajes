import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { createSession, type SignSessionContext } from "@/lib/sign-sessions";
import { notifyClientSignLink } from "@/lib/server/whatsapp-notifications";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // Aseguramos auth para evitar que un endpoint público genere sessions de
  // firma + dispare WA hacia teléfonos arbitrarios desde el número de
  // cualquier org. El user.orgId determina por cuál socket sale el mensaje.
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERROR";
    return NextResponse.json(
      { error: msg === "UNAUTHORIZED" ? "No autenticado" : msg },
      { status: 401 },
    );
  }

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
  // fallos no rompen la creación del QR. El socket WA usado es el de la org
  // del perito que está creando la sesión.
  if (body.clientPhone && body.clientPhone.trim()) {
    notifyClientSignLink({
      clientPhone: body.clientPhone,
      ownerName: context.owner ?? "",
      plate: context.plate ?? "",
      signToken: session.token,
      orgId: user.orgId,
    });
  }
  return NextResponse.json({
    token: session.token,
    expiresAt: session.expiresAt,
  });
}
