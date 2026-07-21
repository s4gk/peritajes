import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserByEmail } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";
import { sendEmail } from "@/lib/server/email";
import { passwordResetEmail } from "@/lib/server/email-templates";
import { createResetToken } from "@/lib/server/password-reset";
import { buildPublicBaseUrl } from "@/lib/server/qr";
import {
  clientIpFromHeaders,
  rateLimitMaybeSweep,
  rateLimitTake,
} from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/forgot  — "olvidé mi contraseña", self-service.
 *
 * Dos reglas mandan en este endpoint:
 *
 * 1. NUNCA revela si un correo está registrado. La respuesta es idéntica
 *    (200 `{ ok: true }`) exista o no la cuenta, esté activa o no, y falle o
 *    no el envío. Si distinguiera, sería un oráculo para enumerar los correos
 *    de todos los peritos de la plataforma.
 * 2. Rate limit por IP y por correo. Sin esto, cualquiera podría inundar el
 *    buzón de una persona pidiendo resets en bucle.
 *
 * El envío en sí es best-effort y se hace ANTES de responder (no en background)
 * para que un fallo del proveedor quede en los logs junto al request.
 */

const BodySchema = z.object({
  email: z.string().min(3).max(254),
});

/** Por IP: tolerante, para no romper una oficina detrás de un solo NAT. */
const IP_LIMIT = { windowMs: 15 * 60 * 1000, max: 20 };
/** Por correo: estricto — es el buzón de una persona concreta. */
const EMAIL_LIMIT = { windowMs: 15 * 60 * 1000, max: 5 };

/** Respuesta única. Se usa en todas las salidas, incluidas las de error. */
function ok() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  rateLimitMaybeSweep();

  let parsed: { email: string };
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    // Ni siquiera un cuerpo inválido cambia la respuesta.
    return ok();
  }

  const ip = clientIpFromHeaders(req.headers);
  if (!rateLimitTake(`forgot:ip:${ip}`, IP_LIMIT).allowed) {
    await logAudit(null, "password.forgot_rate_limited", ip);
    return ok();
  }

  const email = parsed.email.trim().toLowerCase();
  if (!rateLimitTake(`forgot:mail:${email}`, EMAIL_LIMIT).allowed) {
    await logAudit(null, "password.forgot_rate_limited", email);
    return ok();
  }

  try {
    const row = await getUserByEmail(email);

    // Cuenta inexistente o desactivada: se corta acá, en silencio. La persona
    // ve el mismo mensaje de "si el correo existe, te llega un link".
    if (!row || !row.active) {
      await logAudit(null, "password.forgot_no_match", email);
      return ok();
    }

    const info = await createResetToken(row.id, null);
    const base = buildPublicBaseUrl(req) || new URL(req.url).origin;
    const resetUrl = `${base.replace(/\/$/, "")}/reset/${info.token}`;

    const mail = passwordResetEmail({
      fullName: info.fullName,
      resetUrl,
      expiresAt: info.expiresAt,
    });
    const sent = await sendEmail({
      to: row.email ?? email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    await logAudit(
      row.id,
      sent.ok ? "password.forgot_sent" : "password.forgot_send_failed",
      sent.ok ? email : `${email} (${sent.reason})`,
    );
  } catch (err) {
    // Un fallo interno tampoco puede cambiar la respuesta: solo se loguea.
    console.error("[forgot] error procesando la solicitud:", err);
  }

  return ok();
}
