import { NextResponse } from "next/server";

import {
  createUser,
  listUsers,
  requireUser,
  setUserOrg,
  type UserRole,
} from "@/lib/server/auth";
import { createOrganization } from "@/lib/server/orgs";

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
    const actor = await requireUser();
    // listUsers ya aplica el scope correcto por rol (admin = todos,
    // owner = los de su org, employee = solo a sí mismo).
    return NextResponse.json({ users: await listUsers(actor) });
  } catch (e) {
    return unauth(e);
  }
}

/**
 * Reglas de creación de usuarios (multi-tenant):
 *   actor=admin    → puede crear admin, owner (auto-crea org), o employee
 *                    (debe especificar orgId).
 *   actor=owner    → solo employee, dentro de su propia org. orgId del
 *                    request se ignora; usamos siempre el del actor.
 *   actor=employee → 403, no puede crear nada.
 */
export async function POST(req: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  if (actor.role === "employee") {
    return NextResponse.json(
      { error: "Los empleados no pueden crear usuarios." },
      { status: 403 },
    );
  }
  try {
    const body = await req.json();
    const requestedRole: UserRole =
      body.role === "admin"
        ? "admin"
        : body.role === "employee"
          ? "employee"
          : "owner";

    if (actor.role !== "admin" && requestedRole !== "employee") {
      return NextResponse.json(
        { error: "Como dueño solo puedes crear empleados de tu negocio." },
        { status: 403 },
      );
    }

    // Para owners creando employees, el orgId siempre es el del owner
    // (ignoramos lo que mande el body). Para admin creando employee, lo
    // tomamos del body — admin necesita especificar a qué org pertenece.
    let orgId: string | null = null;
    if (requestedRole === "employee") {
      if (actor.role === "owner") {
        orgId = actor.orgId;
      } else {
        orgId =
          typeof body.orgId === "string" && body.orgId.trim()
            ? body.orgId.trim()
            : null;
        if (!orgId) {
          return NextResponse.json(
            { error: "Falta orgId: un empleado debe pertenecer a una org." },
            { status: 400 },
          );
        }
      }
    }

    const user = await createUser({
      username: body.username ?? "",
      password: body.password ?? "",
      fullName: body.fullName ?? "",
      email: body.email ?? null,
      role: requestedRole,
      orgId,
      parentUserId: requestedRole === "employee" ? actor.id : null,
    });

    // Para un owner recién creado, le armamos su org auto-bautizada con su
    // nombre completo. El owner puede renombrarla después desde /empresa.
    if (requestedRole === "owner") {
      const orgName =
        typeof body.orgName === "string" && body.orgName.trim()
          ? body.orgName.trim()
          : `Negocio de ${user.fullName}`;
      const org = await createOrganization(
        { name: orgName, ownerUserId: user.id },
        actor.id,
      );
      await setUserOrg(user.id, org.id, actor.id);
    }

    return NextResponse.json({ user });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
