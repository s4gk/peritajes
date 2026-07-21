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

  // Este endpoint es administrativo: cambia contraseña o activa/desactiva a
  // OTRA persona. Para cambiar la propia contraseña está /api/auth/me, así que
  // un employee no tiene nada que hacer acá.
  if (me.role === "employee") {
    return NextResponse.json(
      { error: "Sin permisos para modificar usuarios." },
      { status: 403 },
    );
  }

  // Un owner solo puede modificar usuarios de SU organización, y nunca a un
  // admin. El admin (Vestel) no tiene org y puede sobre cualquiera.
  if (me.role !== "admin") {
    if (target.role === "admin") {
      return NextResponse.json(
        {
          error: "Solo un administrador puede modificar a otro administrador.",
        },
        { status: 403 },
      );
    }
    if (!me.orgId || target.orgId !== me.orgId) {
      // Mismo cuerpo que "no encontrado" a propósito: no revelamos la
      // existencia de usuarios de otros tenants.
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 },
      );
    }
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
  // Política del 2026-05: SOLO el admin (Vestel) puede eliminar usuarios.
  // Owners no borran empleados — los desactivan vía PATCH active=false
  // si necesitan removerlos del equipo. Mantener la fila histórica es
  // necesario para auditoría: peritajes pasados siguen apuntando a su
  // creador real, y el audit log no se rompe.
  if (me.role !== "admin") {
    return NextResponse.json(
      {
        error:
          "Solo el administrador puede eliminar usuarios. Para retirar a un empleado, desactivá su cuenta.",
      },
      { status: 403 },
    );
  }
  if (params.id === me.id) {
    return NextResponse.json(
      { error: "No puedes eliminar tu propia cuenta." },
      { status: 400 },
    );
  }
  await deleteUser(params.id);
  return NextResponse.json({ ok: true });
}
