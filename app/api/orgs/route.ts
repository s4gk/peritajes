import { NextResponse } from "next/server";

import {
  createUser,
  requireAdmin,
  setUserOrg,
} from "@/lib/server/auth";
import { updateCompanyConfig } from "@/lib/server/company";
import {
  createOrganization,
  listOrganizationsWithDetails,
} from "@/lib/server/orgs";

export const runtime = "nodejs";

function fail(e: unknown) {
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
    return NextResponse.json({ orgs: await listOrganizationsWithDetails() });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Crea una empresa cliente: organization + owner asociado, atómicamente.
 * Solo admin. Body: { orgName, owner: { username, password, fullName, email? } }.
 * Si la creación del user falla, no se crea la org. Si la del org falla
 * después de crear el user, el user queda sin org y se reporta error — admin
 * puede limpiarlo desde /clientes (futuro) o la BD.
 */
export async function POST(req: Request) {
  let actor;
  try {
    actor = await requireAdmin();
  } catch (e) {
    return fail(e);
  }
  try {
    const body = await req.json();
    const orgName = typeof body.orgName === "string" ? body.orgName.trim() : "";
    const ownerInput = body.owner ?? {};
    if (!orgName) {
      return NextResponse.json(
        { error: "El nombre de la empresa es requerido." },
        { status: 400 },
      );
    }

    const owner = await createUser({
      username: ownerInput.username ?? "",
      password: ownerInput.password ?? "",
      fullName: ownerInput.fullName ?? "",
      email: ownerInput.email ?? null,
      role: "owner",
      parentUserId: actor.id,
    });

    const org = await createOrganization(
      { name: orgName, ownerUserId: owner.id },
      actor.id,
    );
    await setUserOrg(owner.id, org.id, actor.id);

    // Sembrar company_config para esta org. Sin esto, el primer peritaje que
    // emita el cliente sale con el header del PDF en blanco (o con la fila
    // legacy id=1 si quedó algo). Después el owner puede completar logo,
    // dirección, NIT, etc. desde /empresa.
    await updateCompanyConfig(org.id, {
      name: orgName,
      tagline: "Peritaje vehicular profesional",
    }).catch((err) => {
      // No rompemos la creación del cliente si esto falla — el owner puede
      // crear la config manualmente desde /empresa más tarde.
      console.error("[orgs] seed company_config falló:", (err as Error).message);
    });

    return NextResponse.json({ org, owner });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
