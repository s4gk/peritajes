import { NextResponse } from "next/server";

import {
  applyRealInspector,
  getInspectionServer,
} from "@/lib/server/inspections";
import { renderInspectionPdf } from "@/lib/server/pdf-render";
import { buildPublicBaseUrl } from "@/lib/server/qr";
import {
  clientIpFromHeaders,
  rateLimitMaybeSweep,
  rateLimitTake,
} from "@/lib/server/rate-limit";
import {
  getShareToken,
  isShareTokenLive,
  touchShareTokenAccess,
} from "@/lib/server/share-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Endpoint público (sin auth) que ejecuta Puppeteer — caro en CPU/memoria.
// Limitamos por IP y por token para que un atacante no pueda agotar el server
// martillando el link, ni enumerar tokens en masa para descubrir peritajes.
const SHARE_LIMIT_PER_IP = { windowMs: 60 * 1000, max: 30 };
const SHARE_LIMIT_PER_TOKEN = { windowMs: 60 * 1000, max: 12 };

function htmlError(title: string, body: string, status: number): NextResponse {
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Inter,system-ui,Arial,sans-serif;background:#f1f5f9;color:#0f172a;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{max-width:420px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px;text-align:center;box-shadow:0 1px 2px rgba(15,23,42,.04)}
  h1{margin:0 0 8px;font-size:20px}
  p{margin:0;color:#475569;font-size:14px;line-height:1.5}
  .icon{font-size:34px;margin-bottom:8px}
</style>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h1>${title}</h1>
    <p>${body}</p>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(req: Request, ctx: { params: { token: string } }) {
  const token = ctx.params.token;
  if (!token) {
    return htmlError(
      "Enlace inválido",
      "El enlace no contiene un token válido. Pedile al perito que te envíe uno nuevo.",
      400,
    );
  }

  rateLimitMaybeSweep();
  const ip = clientIpFromHeaders(req.headers);
  const ipLimit = rateLimitTake(`share:ip:${ip}`, SHARE_LIMIT_PER_IP);
  if (!ipLimit.allowed) {
    return htmlError(
      "Demasiadas solicitudes",
      `Espera unos segundos antes de volver a intentar (reintento en ${Math.ceil(ipLimit.retryAfterSec)}s).`,
      429,
    );
  }
  const tokenLimit = rateLimitTake(`share:tok:${token}`, SHARE_LIMIT_PER_TOKEN);
  if (!tokenLimit.allowed) {
    return htmlError(
      "Enlace muy solicitado",
      "Este peritaje recibió demasiados accesos seguidos. Espera un minuto y vuelve a intentar.",
      429,
    );
  }

  const share = await getShareToken(token);
  if (!share) {
    return htmlError(
      "Enlace no encontrado",
      "Este enlace no existe o fue eliminado. Pídele al perito un enlace actualizado.",
      404,
    );
  }
  if (share.revokedAt) {
    return htmlError(
      "Enlace revocado",
      "El perito revocó este enlace. Pídele uno nuevo si necesitas el peritaje.",
      410,
    );
  }
  if (!isShareTokenLive(share)) {
    return htmlError(
      "Enlace expirado",
      "Este peritaje quedó inaccesible por antigüedad. Pídele al perito un enlace nuevo.",
      410,
    );
  }

  const stored = await getInspectionServer(share.inspectionId);
  if (!stored) {
    return htmlError(
      "Peritaje no disponible",
      "El peritaje asociado a este enlace ya no existe.",
      404,
    );
  }

  try {
    const base = buildPublicBaseUrl(req);
    const verificationUrl = base ? `${base}/r/${token}` : `/r/${token}`;
    // Misma corrección de identidad que en ensureCompletedPdf: el PDF público
    // debe mostrar el nombre/cédula/firma del dueño real, no el texto legacy
    // copiado ni la firma global de disco.
    const dataForPdf = await applyRealInspector(
      stored.data,
      stored.userId ?? null,
    );
    const { buffer, plateSlug } = await renderInspectionPdf({
      data: dataForPdf,
      verificationUrl,
      reportNumber: stored.reportNumber ?? null,
      // Render público: usa la org del peritaje, no la del visitante (no
      // hay sesión). Si la fila legacy no tiene org, sale con defaults.
      orgId: stored.orgId ?? null,
    });
    // Fire-and-forget access tracking; no need to block the response on it.
    touchShareTokenAccess(token).catch(() => {});
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="peritaje-${plateSlug}.pdf"`,
        "cache-control": "private, max-age=0, no-store",
        "content-length": String(buffer.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return htmlError(
      "Error al generar el peritaje",
      `No pudimos generar el PDF en este momento. Intentá de nuevo en unos minutos.<br/><br/><small>${message}</small>`,
      500,
    );
  }
}
