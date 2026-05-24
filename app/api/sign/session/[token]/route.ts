import { NextResponse } from "next/server";

import { getInspectionServer } from "@/lib/server/inspections";
import { getSession, submitSignature } from "@/lib/sign-sessions";
import { notifyPeritoSignatureReceived } from "@/lib/server/whatsapp-notifications";

export const runtime = "nodejs";

type Params = { params: { token: string } };

export async function GET(_request: Request, { params }: Params) {
  const session = await getSession(params.token);
  if (!session) {
    return NextResponse.json({ error: "expired" }, { status: 404 });
  }
  return NextResponse.json({
    token: session.token,
    context: session.context,
    signature: session.signature ?? null,
    signedAt: session.signedAt ?? null,
    expiresAt: session.expiresAt,
  });
}

export async function POST(request: Request, { params }: Params) {
  let body: { signature?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const signature = body.signature;
  if (typeof signature !== "string" || !signature.startsWith("data:image/")) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  if (signature.length > 500_000) {
    // ~375 KB base64 is plenty for a signature PNG
    return NextResponse.json({ error: "signature too large" }, { status: 413 });
  }
  const session = await submitSignature(params.token, signature);
  if (!session) {
    return NextResponse.json({ error: "expired" }, { status: 404 });
  }

  // Si la firma vino del flow REMOTO (link WA, sin perito al lado), avisamos
  // al perito asignado para que entre a finalizar. Fire-and-forget: cualquier
  // fallo del WA no debe romper la firma del cliente.
  if (session.mode === "remote" && session.inspectionId) {
    void (async () => {
      try {
        const insp = await getInspectionServer(session.inspectionId!);
        if (!insp) return;
        await notifyPeritoSignatureReceived({
          peritoUserId: insp.userId ?? null,
          inspectionId: insp.id,
          plate: insp.data?.vehicle?.plate ?? "",
          ownerName: insp.data?.vehicle?.owner ?? "",
          orgId: insp.orgId ?? null,
        });
      } catch (err) {
        console.error(
          "[sign] perito notify falló:",
          (err as Error).message,
        );
      }
    })();
  }

  return NextResponse.json({ ok: true, signedAt: session.signedAt });
}
