import { NextResponse } from "next/server";

import { getSession, submitSignature } from "@/lib/sign-sessions";

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
  return NextResponse.json({ ok: true, signedAt: session.signedAt });
}
