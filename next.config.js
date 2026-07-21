/** @type {import('next').NextConfig} */

// Perito se sirve directo desde server.js (no hay nginx delante), así que
// estos headers los tiene que poner Next: nadie más los va a agregar.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // camera=(self) es indispensable: el wizard captura fotos con getUserMedia.
    value: "camera=(self), microphone=(), geolocation=(self), payment=()",
  },
  {
    // 1 año. Ojo: activarlo de verdad requiere un cert de CA pública — con el
    // mkcert actual sobre IP el navegador ignora HSTS igual.
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next inyecta scripts inline (hidratación, next/script) y usa eval en
      // dev. 'unsafe-inline' se puede quitar migrando a nonces si algún día
      // vale la pena; por ahora el riesgo real acá es bajo.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
      // rsms.me sirve la fuente Inter (app/layout.tsx:109). Para una PWA
      // offline-first convendría self-hostearla, pero eso es otra tarea.
      "style-src 'self' 'unsafe-inline' https://rsms.me",
      // data: y blob: son obligatorios: las fotos del peritaje y los PDFs se
      // manejan como data URL / blob en el cliente.
      "img-src 'self' data: blob:",
      "font-src 'self' data: https://rsms.me",
      "connect-src 'self' blob:",
      // El PDF se descarga como blob y el visor lo abre en un object/iframe.
      "object-src 'self' blob:",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    instrumentationHook: true,
    // baileys y pino salieron del proyecto (WhatsApp Web no oficial, retirado);
    // sharp se usa en el shrink de imágenes del PDF y debe quedar externo.
    serverComponentsExternalPackages: ["puppeteer", "qrcode", "sharp"],
  },
};

module.exports = nextConfig;
