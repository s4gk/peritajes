#!/usr/bin/env node
/**
 * Genera los iconos PWA usando puppeteer (que ya está en deps) para renderizar
 * un SVG en distintos tamaños. Sin agregar dependencias.
 *
 *   node scripts/generate-pwa-icons.mjs
 *
 * Salida en /public/icons/:
 *   - icon-192.png            (any)
 *   - icon-512.png            (any)
 *   - icon-maskable-512.png   (maskable, con safe area)
 *   - apple-touch-icon.png    (180, sin maskable, fondo opaco)
 *   - favicon-32.png          (favicon clásico)
 *   - favicon.svg             (favicon SVG escalable para browsers modernos)
 */

import puppeteer from "puppeteer";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "public", "icons");

// Diseño:
//   - Fondo slate-900 (#0f172a) que matchea theme_color y la sidebar.
//   - Letra "P" en blanco, Inter bold 700, con un pequeño check verde (#22c55e)
//     a la derecha que representa el peritaje aprobado.
//   - En maskable se mantiene el contenido dentro del 80% central (safe area
//     del 10% por lado).
function buildSvg({ inset, withCheck = true }) {
  const SIZE = 512;
  const radius = inset > 0 ? 0 : 88; // sin radio en maskable (el OS recorta)
  const inner = SIZE - inset * 2;
  // Coordenadas relativas a un viewBox 512x512.
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const fontSize = Math.round(inner * 0.62);
  const checkR = Math.round(inner * 0.085);
  const checkCx = cx + Math.round(inner * 0.22);
  const checkCy = cy - Math.round(inner * 0.18);
  const checkStroke = Math.round(checkR * 0.35);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1e293b"/>
        <stop offset="100%" stop-color="#0f172a"/>
      </linearGradient>
    </defs>
    <rect x="${inset}" y="${inset}" width="${inner}" height="${inner}" rx="${radius}" fill="url(#bg)"/>
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
      font-family="Inter, 'Helvetica Neue', Arial, sans-serif"
      font-size="${fontSize}" font-weight="800" fill="#ffffff" letter-spacing="-6">P</text>
    ${
      withCheck
        ? `<g>
            <circle cx="${checkCx}" cy="${checkCy}" r="${checkR}" fill="#22c55e"/>
            <path d="M ${checkCx - checkR * 0.45} ${checkCy + checkR * 0.05}
                     L ${checkCx - checkR * 0.1} ${checkCy + checkR * 0.4}
                     L ${checkCx + checkR * 0.5} ${checkCy - checkR * 0.3}"
                  stroke="#ffffff" stroke-width="${checkStroke}"
                  stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </g>`
        : ""
    }
  </svg>`;
}

function htmlWrap(svg, size) {
  return `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${svg}</body></html>`;
}

async function renderPng(page, svg, size, outFile) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(htmlWrap(svg, size), { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: outFile, omitBackground: true, type: "png" });
  process.stdout.write(`  ${path.relative(process.cwd(), outFile)} ${size}x${size}\n`);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const anySvg = buildSvg({ inset: 0 });
  // Maskable: el OS recorta hasta el 80% central, así que metemos el contenido
  // dentro del safe area dejando 10% de margen (~51px en 512).
  const maskableSvg = buildSvg({ inset: 56 });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await renderPng(page, anySvg, 192, path.join(OUT_DIR, "icon-192.png"));
    await renderPng(page, anySvg, 512, path.join(OUT_DIR, "icon-512.png"));
    await renderPng(page, maskableSvg, 512, path.join(OUT_DIR, "icon-maskable-512.png"));
    // iOS prefers icons without transparency; usamos el mismo "any" con fondo
    // opaco (el SVG ya tiene fondo).
    await renderPng(page, anySvg, 180, path.join(OUT_DIR, "apple-touch-icon.png"));
    await renderPng(page, anySvg, 32, path.join(OUT_DIR, "favicon-32.png"));
  } finally {
    await browser.close();
  }

  // SVG favicon (escala fina en cualquier tamaño de pestaña).
  await fs.writeFile(path.join(OUT_DIR, "favicon.svg"), anySvg, "utf8");
  process.stdout.write(`  ${path.relative(process.cwd(), path.join(OUT_DIR, "favicon.svg"))} svg\n`);

  process.stdout.write("\nListo. Iconos generados en public/icons/\n");
}

main().catch((err) => {
  console.error("Error generando iconos:", err);
  process.exit(1);
});
