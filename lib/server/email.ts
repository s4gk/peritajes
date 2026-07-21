import "server-only";

/**
 * Envío de correo transaccional vía Resend (https://resend.com).
 *
 * Se habla la API REST directo con fetch, sin SDK — mismo criterio que
 * `whatsapp-meta.ts` con la Cloud API de Meta: es un solo POST, y una
 * dependencia menos en el bundle del server.
 *
 * Activo cuando RESEND_API_KEY y EMAIL_FROM están en el entorno. Si falta
 * configuración NO se lanza: se devuelve `{ ok: false, reason: "not_configured" }`
 * y se loguea una vez, para que un despliegue sin correo no tumbe flujos que
 * pueden seguir sin él. Quien llama decide si eso es fatal.
 *
 * OJO con la entregabilidad: Resend exige un dominio verificado (SPF + DKIM)
 * para mandar a terceros. Con el dominio sin verificar solo se puede enviar a
 * la propia cuenta, y el resto rebota. Ver .env.example.
 */

const RESEND_API = "https://api.resend.com/emails";

/** Timeout del request. Un correo colgado no debe bloquear el response HTTP. */
const SEND_TIMEOUT_MS = 10_000;

function apiKey(): string {
  return process.env.RESEND_API_KEY?.trim() ?? "";
}

/** Remitente. Formato aceptado: "Nombre <buzon@dominio.com>" o solo el buzón. */
function from(): string {
  return process.env.EMAIL_FROM?.trim() ?? "";
}

export function isEmailConfigured(): boolean {
  return !!(apiKey() && from());
}

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  /** Alternativa en texto plano. Mejora entregabilidad y sirve en clientes
   *  que no renderizan HTML. */
  text: string;
  replyTo?: string;
};

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: "not_configured" | "http_error" | "network"; detail?: string };

/** Se loguea una sola vez por proceso para no inundar pm2 en cada request. */
let warnedMissingConfig = false;

export async function sendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        "[email] RESEND_API_KEY / EMAIL_FROM no configurados — no se enviará ningún correo. Ver .env.example.",
      );
    }
    return { ok: false, reason: "not_configured" };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: from(),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      signal: ctrl.signal,
    });

    const body = await res.text();
    if (!res.ok) {
      // El cuerpo de Resend trae el motivo real (dominio sin verificar, from
      // inválido, cuota). Sin loguearlo, un correo que no llega es indepurable.
      console.error(
        `[email] Resend respondió ${res.status}: ${body.slice(0, 400)}`,
      );
      return { ok: false, reason: "http_error", detail: `${res.status}` };
    }

    let id: string | null = null;
    try {
      id = (JSON.parse(body) as { id?: string }).id ?? null;
    } catch {
      /* respuesta sin JSON útil: no es motivo para fallar el envío */
    }
    return { ok: true, id };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    console.error(
      `[email] fallo de red al enviar${aborted ? " (timeout)" : ""}:`,
      err instanceof Error ? err.message : err,
    );
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}
