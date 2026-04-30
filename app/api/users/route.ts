import { NextResponse } from "next/server";

import {
  createUser,
  listUsers,
  requireAdmin,
} from "@/lib/server/auth";

export const runtime = "nodejs";

function unauth(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (msg === "FORBIDDEN")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ users: await listUsers() });
  } catch (e) {
    return unauth(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return unauth(e);
  }
  try {
    const body = await req.json();
    const user = await createUser({
      username: body.username ?? "",
      password: body.password ?? "",
      fullName: body.fullName ?? "",
      email: body.email ?? null,
      role: body.role === "admin" ? "admin" : "perito",
    });
    return NextResponse.json({ user });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
