import "server-only";

import { getCompanyBranding } from "@/lib/company";

/**
 * Plantillas de correo transaccional.
 *
 * Reglas de correo (por las que esto no se parece al resto de la UI):
 *  - CSS inline y layout con <table>. Gmail y Outlook siguen ignorando <style>
 *    en <head> y no soportan flex/grid de forma confiable.
 *  - Nada de imágenes remotas ni fuentes externas: la mayoría de clientes las
 *    bloquea por defecto, así que el correo tiene que leerse bien sin ellas.
 *  - Siempre acompañado de una versión en texto plano (mejora entregabilidad
 *    y es lo que se ve en relojes y clientes en modo texto).
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Formatea la expiración en horario de Colombia, que es donde está el usuario. */
function formatExpiry(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-CO", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "America/Bogota",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function shell(brandName: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="es">
<body style="margin:0; padding:0; background-color:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9; padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px; background-color:#ffffff; border-radius:12px; border:1px solid #e2e8f0; overflow:hidden;">
          <tr>
            <td style="padding:24px 28px 8px 28px; font-family:Arial,Helvetica,sans-serif;">
              <div style="font-size:15px; font-weight:700; color:#0f172a; letter-spacing:-0.01em;">
                ${escapeHtml(brandName)}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px 28px; font-family:Arial,Helvetica,sans-serif;">
              ${bodyHtml}
            </td>
          </tr>
        </table>
        <div style="max-width:520px; margin-top:16px; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:18px; color:#64748b; text-align:center;">
          Este es un mensaje automático de ${escapeHtml(brandName)}. No respondas a este correo.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export type PasswordResetEmail = { subject: string; html: string; text: string };

/**
 * Correo de recuperación de contraseña.
 *
 * El link va como botón y ADEMÁS en texto plano copiable: muchos clientes
 * corporativos reescriben o rompen los href, y el usuario necesita una salida.
 */
export function passwordResetEmail(opts: {
  fullName: string;
  resetUrl: string;
  expiresAt: string;
}): PasswordResetEmail {
  const brand = getCompanyBranding().name;
  const firstName = opts.fullName.trim().split(/\s+/)[0] || opts.fullName;
  const expiry = formatExpiry(opts.expiresAt);

  const html = shell(
    brand,
    `
    <h1 style="margin:16px 0 12px 0; font-size:20px; line-height:28px; font-weight:700; color:#0f172a;">
      Restablece tu contraseña
    </h1>
    <p style="margin:0 0 16px 0; font-size:15px; line-height:23px; color:#334155;">
      Hola ${escapeHtml(firstName)}, recibimos una solicitud para cambiar la contraseña de tu cuenta.
      Toca el botón para elegir una nueva.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
      <tr>
        <td style="border-radius:8px; background-color:#0f172a;">
          <a href="${escapeHtml(opts.resetUrl)}"
             style="display:inline-block; padding:12px 24px; font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:700; color:#ffffff; text-decoration:none; border-radius:8px;">
            Crear contraseña nueva
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px 0; font-size:13px; line-height:20px; color:#64748b;">
      Si el botón no funciona, copia y pega este enlace en tu navegador:
    </p>
    <p style="margin:0 0 20px 0; font-size:13px; line-height:20px; color:#0f172a; word-break:break-all;">
      ${escapeHtml(opts.resetUrl)}
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px; border-top:1px solid #e2e8f0;">
      <tr>
        <td style="padding-top:16px; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:20px; color:#64748b;">
          El enlace sirve <strong style="color:#334155;">una sola vez</strong> y vence el ${escapeHtml(expiry)}.<br />
          Al cambiar la contraseña se cerrarán todas tus sesiones abiertas.<br /><br />
          <strong style="color:#334155;">¿No fuiste tú?</strong> Ignora este correo: tu contraseña actual sigue funcionando.
        </td>
      </tr>
    </table>`,
  );

  const text = `Restablece tu contraseña

Hola ${firstName}, recibimos una solicitud para cambiar la contraseña de tu cuenta de ${brand}.

Abre este enlace para elegir una nueva:
${opts.resetUrl}

El enlace sirve una sola vez y vence el ${expiry}.
Al cambiar la contraseña se cerrarán todas tus sesiones abiertas.

¿No fuiste tú? Ignora este correo: tu contraseña actual sigue funcionando.

--
${brand}. Mensaje automático, no respondas a este correo.`;

  return {
    subject: `Restablece tu contraseña de ${brand}`,
    html,
    text,
  };
}
