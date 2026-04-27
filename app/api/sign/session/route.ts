import { NextResponse } from "next/server";

import { createSession, type SignSessionContext } from "@/lib/sign-sessions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { context?: SignSessionContext } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const context = body.context ?? {};
  const session = createSession(context);
  return NextResponse.json({
    token: session.token,
    expiresAt: session.expiresAt,
  });
}
