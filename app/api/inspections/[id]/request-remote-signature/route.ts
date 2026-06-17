import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";
import {
  checkInspectionAccess,
  getInspectionServer,
} from "@/lib/server/inspections";
import {
  createSession,
  getActiveRemoteSessionForInspection,
} from "@/lib/sign-sessions";
import { resolveWaOrgId } from "@/lib/server/whatsapp-meta";
import { notifyClientRemoteSignLink } from "@/lib/server/whatsapp-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Crea una sesión de firma REMOTA (TTL 72h) y le manda el link al cliente por
 * WhatsApp. A diferencia del flow presencial (`POST /api/sign/session` con
 * un QR mostrado en pantalla), este endpoint está pensado para cuando el
 * cliente no está físicamente con el perito: el perito termina la inspección
 * y manda el link para que el cliente firme desde casa cuando pueda.
 *
 * Idempotencia: si ya hay una sesión remota activa para este peritaje, la
 * devolvemos en vez de crear otra y mandar otro WA. El perito puede forzar
 * un re-envío pasando `force: true` en el body — eso genera un token nuevo.
 *
 * Restricciones:
 *  - El peritaje no puede estar finalizado (locked); si ya lo está, no tiene
 *    sentido pedir firma.
 *  - Debe haber `ownerPhone` en el peritaje (sin teléfono no podemos mandar
 *    el link).
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERROR";
    return NextResponse.json(
      { error: msg === "UNAUTHORIZED" ? "No autenticado" : msg },
      { status: msg === "UNAUTHORIZED" ? 401 : 400 },
    );
  }

  const access = await checkInspectionAccess(params.id, user);
  if (access.kind === "not_found") {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  if (access.kind === "forbidden") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const stored = await getInspectionServer(params.id);
  if (!stored) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  if (stored.lockedAt) {
    return NextResponse.json(
      {
        error:
          "El peritaje ya está finalizado. No se puede pedir firma sobre un peritaje cerrado.",
      },
      { status: 409 },
    );
  }
  const vehicle = stored.data.vehicle;
  const phone = vehicle?.ownerPhone?.trim();
  if (!phone) {
    return NextResponse.json(
      {
        error:
          "Falta el teléfono del cliente. Cárgalo en el paso Vehículo antes de pedir firma remota.",
      },
      { status: 422 },
    );
  }

  let force = false;
  try {
    const body = (await req.json().catch(() => ({}))) as { force?: boolean };
    force = body.force === true;
  } catch {
    /* body opcional */
  }

  if (!force) {
    const existing = await getActiveRemoteSessionForInspection(params.id);
    if (existing) {
      // Sesión activa: la devolvemos sin re-mandar WA. El wizard la usa para
      // mostrar "esperando firma del cliente (link enviado hace Xh)".
      return NextResponse.json({
        token: existing.token,
        expiresAt: existing.expiresAt,
        signedAt: existing.signedAt ?? null,
        reused: true,
      });
    }
  }

  const session = await createSession(
    {
      plate: vehicle?.plate ?? "",
      make: vehicle?.make ?? "",
      model: vehicle?.model ?? "",
      year: vehicle?.year ?? "",
      inspector: vehicle?.inspector ?? user.fullName ?? "",
      owner: vehicle?.owner ?? "",
    },
    { mode: "remote", inspectionId: params.id },
  );

  notifyClientRemoteSignLink({
    clientPhone: phone,
    ownerName: vehicle?.owner ?? "",
    plate: vehicle?.plate ?? "",
    vehicleLabel: [vehicle?.make, vehicle?.model].filter(Boolean).join(" "),
    inspectorName: user.fullName ?? "el perito asignado",
    signToken: session.token,
    orgId: resolveWaOrgId(user, stored.orgId ?? null),
    inspectionId: params.id,
  });

  await logAudit(user.id, "inspection.remote_sign_requested", params.id);

  return NextResponse.json({
    token: session.token,
    expiresAt: session.expiresAt,
    signedAt: null,
    reused: false,
  });
}

/**
 * Estado de la firma remota: indica si hay sesión activa, si ya firmó, cuándo
 * expira. El wizard pollea esto cada 5s mientras esté esperando firma para
 * pintar el estado en vivo (sin recargar la página).
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERROR";
    return NextResponse.json(
      { error: msg === "UNAUTHORIZED" ? "No autenticado" : msg },
      { status: msg === "UNAUTHORIZED" ? 401 : 400 },
    );
  }

  const access = await checkInspectionAccess(params.id, user);
  if (access.kind === "not_found") {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  if (access.kind === "forbidden") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  // Buscamos cualquier sesión remota: activa (esperando firma) o firmada
  // reciente. El wizard discrimina por `signedAt !== null`.
  const active = await getActiveRemoteSessionForInspection(params.id);
  if (active) {
    return NextResponse.json({
      hasSession: true,
      token: active.token,
      expiresAt: active.expiresAt,
      signedAt: null,
      signature: null,
    });
  }
  // No hay sesión activa pero podría haber una recién firmada cuyo state aún
  // no se refleja en el data del peritaje. Le respondemos con `signedAt`
  // populado para que el wizard sepa que tiene que recoger la firma.
  const { getSignedRemoteSessionForInspection } = await import(
    "@/lib/sign-sessions"
  );
  const signed = await getSignedRemoteSessionForInspection(params.id);
  if (signed) {
    return NextResponse.json({
      hasSession: true,
      token: signed.token,
      expiresAt: signed.expiresAt,
      signedAt: signed.signedAt ?? null,
      signature: signed.signature ?? null,
    });
  }
  return NextResponse.json({
    hasSession: false,
    token: null,
    expiresAt: null,
    signedAt: null,
    signature: null,
  });
}
