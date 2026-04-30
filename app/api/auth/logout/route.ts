import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  clearSessionCookie,
  destroySession,
} from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";

export const runtime = "nodejs";

export async function POST() {
  const sid = cookies().get(SESSION_COOKIE)?.value;
  if (sid) {
    await destroySession(sid);
    await logAudit(null, "logout");
  }
  clearSessionCookie();
  return NextResponse.json({ ok: true });
}
