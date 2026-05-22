import { NextResponse } from "next/server";

import {
  deleteUser,
  getUserById,
  requireUser,
  setUserActive,
  setUserPassword,
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

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return unauth(e);
  }

  const target = await getUserById(params.id);
  if (!target) {
    return NextResponse.json(
      { error: "Usuario no encontrado" },
      { status: 404 },
    );
  }

  // Un owner solo puede modificar otros owners — no debe poder cambiar
  // contraseña ni desactivar a un admin. El admin puede todo.
  if (me.role !== "admin" && target.role === "admin") {
    return NextResponse.json(
      { error: "Solo un administrador puede modificar a otro administrador." },
      { status: 403 },
    );
  }

  try {
    const body = await req.json();
    if (typeof body.password === "string") {
      await setUserPassword(params.id, body.password);
    }
    if (typeof body.active === "boolean") {
      // Don't let a user disable themselves and lose access
      if (params.id === me.id && body.active === false) {
        return NextResponse.json(
          { error: "No puedes desactivar tu propia cuenta." },
          { status: 400 },
        );
      }
      await setUserActive(params.id, body.active);
    }
    return NextResponse.json({ ok: true, user: await getUserById(params.id) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  if (params.id === me.id) {
    return NextResponse.json(
      { error: "No puedes eliminar tu propia cuenta." },
      { status: 400 },
    );
  }
  // Borrar admin solo lo puede otro admin. Owner borra owners.
  const target = await getUserById(params.id);
  if (target?.role === "admin" && me.role !== "admin") {
    return NextResponse.json(
      { error: "Solo un administrador puede eliminar a otro administrador." },
      { status: 403 },
    );
  }
  await deleteUser(params.id);
  return NextResponse.json({ ok: true });
}
