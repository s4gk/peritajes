import { type NextRequest, NextResponse } from "next/server";

import { query } from "@/lib/server/db";
import { verifyTwilioSignature } from "@/lib/server/whatsapp-twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook de Twilio — recibe status callbacks (sent, delivered, read, failed,
 * undelivered) y mensajes entrantes. A diferencia de Meta, Twilio:
 *  - No hace un GET de verificación (no hay challenge).
 *  - Envía el cuerpo como `application/x-www-form-urlencoded` (no JSON).
 *  - Firma con `X-Twilio-Signature` (HMAC-SHA1 sobre la URL + params ordenados).
 *
 * La firma se valida sobre la URL EXACTA que Twilio llamó. Detrás de un proxy,
 * `req.url` puede traer el host interno, así que reconstruimos la URL pública
 * con APP_PUBLIC_URL + el pathname (debe coincidir con la URL configurada en
 * Twilio Console). Sin APP_PUBLIC_URL caemos a req.url.
 */
function publicWebhookUrl(req: NextRequest): string {
  const base = process.env.APP_PUBLIC_URL?.trim().replace(/\/$/, "");
  const { pathname, search } = new URL(req.url);
  return base ? `${base}${pathname}${search}` : req.url;
}

export async function POST(req: NextRequest) {
  // Twilio manda form-encoded. Parseamos a un mapa plano para validar firma
  // (que se calcula sobre los pares clave/valor) y para auditar.
  const raw = await req.text();
  const form = new URLSearchParams(raw);
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = v;

  const verdict = verifyTwilioSignature(
    publicWebhookUrl(req),
    params,
    req.headers.get("x-twilio-signature"),
  );
  if (verdict.ok === false) {
    console.warn(`[twilio-webhook] firma inválida (${verdict.reason}) — rechazado.`);
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }
  if (verdict.ok === null) {
    console.warn(
      "[twilio-webhook] TWILIO_AUTH_TOKEN no configurado — webhook sin validar firma. Configúralo en producción.",
    );
  }

  void handleTwilioPayload(params).catch((err) =>
    console.error("[twilio-webhook]", (err as Error).message),
  );

  // Twilio espera 200 (o TwiML). Respondemos vacío para no auto-responder.
  return new NextResponse("", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

async function handleTwilioPayload(
  params: Record<string, string>,
): Promise<void> {
  // Status callback: trae MessageStatus (queued/sent/delivered/read/failed...).
  if (params.MessageStatus || params.SmsStatus) {
    await query(
      `INSERT INTO audit_log (user_id, org_id, action, detail)
       VALUES (NULL, NULL, 'wa.webhook.status', $1)`,
      [
        JSON.stringify({
          provider: "twilio",
          msg_id: params.MessageSid ?? params.SmsSid ?? null,
          to: params.To ?? null,
          status: params.MessageStatus ?? params.SmsStatus ?? null,
          error_code: params.ErrorCode ?? null,
        }),
      ],
    ).catch(() => {});
    return;
  }

  // Mensaje entrante — solo lo registramos; no hay bot de respuesta.
  if (params.Body !== undefined || params.From) {
    await query(
      `INSERT INTO audit_log (user_id, org_id, action, detail)
       VALUES (NULL, NULL, 'wa.webhook.inbound', $1)`,
      [
        JSON.stringify({
          provider: "twilio",
          from: params.From ?? null,
          num_media: params.NumMedia ?? "0",
        }),
      ],
    ).catch(() => {});
  }
}
