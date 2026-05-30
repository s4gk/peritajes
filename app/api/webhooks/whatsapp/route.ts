import { type NextRequest, NextResponse } from "next/server";

import { query } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — Meta llama este endpoint una sola vez al registrar el webhook en el
 * panel de Meta Business Manager. Devuelve el hub.challenge si el
 * hub.verify_token coincide con META_WA_VERIFY_TOKEN en el entorno.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.META_WA_VERIFY_TOKEN?.trim() ?? "";

  if (mode === "subscribe" && verifyToken && token === verifyToken && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * POST — Meta envía aquí todos los eventos: delivery status (sent, delivered,
 * read, failed) y mensajes entrantes. Respondemos 200 inmediatamente y
 * procesamos en fire-and-forget para no hacer esperar a Meta (tienen un
 * timeout de ~20 s y reintentarían si no responde a tiempo).
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  void handleWebhookPayload(body).catch((err) =>
    console.error("[wa-webhook]", (err as Error).message),
  );

  return NextResponse.json({ ok: true });
}

async function handleWebhookPayload(payload: unknown): Promise<void> {
  const p = payload as Record<string, unknown>;
  if (p.object !== "whatsapp_business_account") return;

  const entries = (p.entry ?? []) as Array<Record<string, unknown>>;
  for (const entry of entries) {
    const changes = (entry.changes ?? []) as Array<Record<string, unknown>>;
    for (const change of changes) {
      if (change.field !== "messages") continue;
      const value = change.value as Record<string, unknown> | undefined;
      if (!value) continue;

      // Status de entrega: sent → delivered → read / failed
      const statuses = (value.statuses ?? []) as Array<Record<string, unknown>>;
      for (const status of statuses) {
        await query(
          `INSERT INTO audit_log (user_id, org_id, action, detail)
           VALUES (NULL, NULL, 'wa.webhook.status', $1)`,
          [
            JSON.stringify({
              msg_id: status.id,
              to: status.recipient_id,
              status: status.status,
              timestamp: status.timestamp,
              errors: (status.errors as unknown[] | undefined) ?? [],
            }),
          ],
        ).catch(() => {});
      }

      // Mensajes entrantes — solo los registramos; no hay bot de respuesta.
      const messages = (value.messages ?? []) as Array<Record<string, unknown>>;
      for (const msg of messages) {
        await query(
          `INSERT INTO audit_log (user_id, org_id, action, detail)
           VALUES (NULL, NULL, 'wa.webhook.inbound', $1)`,
          [
            JSON.stringify({
              from: msg.from,
              type: msg.type,
              timestamp: msg.timestamp,
            }),
          ],
        ).catch(() => {});
      }
    }
  }
}
