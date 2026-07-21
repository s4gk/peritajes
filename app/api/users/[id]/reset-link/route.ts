import { NextResponse } from "next/server";

import { getUserById, requireUser } from "@/lib/server/auth";
import { createResetToken } from "@/lib/server/password-reset";
import { buildPublicBaseUrl } from "@/lib/server/qr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauth(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (msg === "FORBIDDEN")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  // Antes esto era requireAdmin(), y por eso la función era INALCANZABLE: la
  // única pantalla que la llama es /usuarios, que el sidebar solo le muestra
  // al owner (a los admin la página los manda a /clientes). Resultado: el
  // owner pulsaba "Link de reset" y recibía 403. Nunca se generó un token.
  //
  // El owner es justamente quien tiene que poder desbloquear a su empleado, así
  // que se le permite — acotado a su organización, como en users/[id] PATCH.
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  if (me.role === "employee") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const target = await getUserById(params.id);
  if (!target) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }
  if (me.role !== "admin") {
    if (target.role === "admin" || !me.orgId || target.orgId !== me.orgId) {
      // Mismo cuerpo que "no encontrado": no revelamos usuarios de otras orgs.
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 },
      );
    }
  }

  try {
    const info = await createResetToken(params.id, me.id);
    const base = buildPublicBaseUrl(req);
    const url = base ? `${base}/reset/${info.token}` : `/reset/${info.token}`;
    return NextResponse.json({
      token: info.token,
      url,
      expiresAt: info.expiresAt,
      user: {
        id: info.userId,
        fullName: info.fullName,
        username: info.username,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
