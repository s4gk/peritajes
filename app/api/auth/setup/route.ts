import { NextResponse } from "next/server";

import {
  countUsers,
  createSession,
  createUser,
  setSessionCookie,
} from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";

export const runtime = "nodejs";

/**
 * First-run admin creation. Only succeeds while the users table is empty —
 * after that this endpoint refuses, so it can't be used to bypass auth.
 */
export async function POST(req: Request) {
  if ((await countUsers()) > 0) {
    return NextResponse.json(
      { error: "El sistema ya fue configurado. Usa la página de login." },
      { status: 409 },
    );
  }

  let body: {
    username?: string;
    password?: string;
    fullName?: string;
    email?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  try {
    const user = await createUser({
      username: body.username ?? "",
      password: body.password ?? "",
      fullName: body.fullName ?? "",
      email: body.email ?? null,
      role: "admin",
    });
    const sid = await createSession(user.id, req.headers.get("user-agent") ?? undefined);
    setSessionCookie(sid);
    await logAudit(user.id, "setup.completed");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ needsSetup: (await countUsers()) === 0 });
}
