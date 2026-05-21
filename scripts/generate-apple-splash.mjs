#!/usr/bin/env node
/**
 * Genera apple-touch-startup-image PNGs para los iPhones/iPads más comunes.
 *
 *   node scripts/generate-apple-splash.mjs
 *
 * Cada PNG es el splash que iOS muestra al abrir la PWA standalone (cuando
 * el usuario hizo "Agregar a inicio"). Sin estos archivos iOS muestra una
 * pantalla blanca durante el cold start hasta que el JS hidrata.
 *
 * Las medidas son las dimensiones del dispositivo × DPR. iOS espera el archivo
 * matcheado por media query exacta (device-width, device-height, DPR, orientation).
 */

import puppeteer from "puppeteer";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "public", "icons", "splash");

// Lista compacta — cubrimos las pantallas modernas más comunes. El media query
// asociado se exporta junto con el archivo en `apple-splash-media.json` para
// que el layout pueda emitir los <link> sin hardcodear nada.
const DEVICES = [
  { name: "iphone-15-16-pro-max-portrait",
    width: 1320, height: 2868, dpr: 3,
    media: "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  { name: "iphone-14-15-pro-max-portrait",
    width: 1290, height: 2796, dpr: 3,
    media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  { name: "iphone-14-15-16-pro-portrait",
    width: 1179, height: 2556, dpr: 3,
    media: "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  { name: "iphone-13-pro-max-12-pro-max-portrait",
    width: 1284, height: 2778, dpr: 3,
    media: "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  { name: "iphone-14-13-13-pro-12-12-pro-portrait",
    width: 1170, height: 2532, dpr: 3,
    media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  { name: "iphone-13-mini-12-mini-x-xs-portrait",
    width: 1125, height: 2436, dpr: 3,
    media: "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  { name: "iphone-11-xr-portrait",
    width: 828, height: 1792, dpr: 2,
    media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
  { name: "iphone-se-8-7-portrait",
    width: 750, height: 1334, dpr: 2,
    media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
  { name: "ipad-pro-12.9-portrait",
    width: 2048, height: 2732, dpr: 2,
    media: "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
  { name: "ipad-pro-11-portrait",
    width: 1668, height: 2388, dpr: 2,
    media: "(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
  { name: "ipad-air-portrait",
    width: 1640, height: 2360, dpr: 2,
    media: "(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
  { name: "ipad-portrait",
    width: 1536, height: 2048, dpr: 2,
    media: "(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
];

function buildSplashHtml(width, height) {
  // El logo ocupa ~30% del lado menor para verse cómodo en cualquier device.
  const short = Math.min(width, height);
  const logoSize = Math.round(short * 0.30);
  const fontSize = Math.round(logoSize * 0.62);
  const checkR = Math.round(logoSize * 0.085);
  const titleFs = Math.round(short * 0.035);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;width:${width}px;height:${height}px;background:#0f172a;overflow:hidden;
      font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:#fff}
    .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(short * 0.025)}px}
    .logo{position:relative;width:${logoSize}px;height:${logoSize}px;background:linear-gradient(180deg,#1e293b 0%,#0f172a 100%);
      border-radius:${Math.round(logoSize * 0.17)}px;display:flex;align-items:center;justify-content:center;
      box-shadow:0 ${Math.round(short * 0.015)}px ${Math.round(short * 0.04)}px rgba(0,0,0,.45)}
    .logo .P{font-size:${fontSize}px;font-weight:800;color:#fff;letter-spacing:-${Math.round(fontSize * 0.02)}px;line-height:1}
    .check{position:absolute;top:${Math.round(logoSize * 0.16)}px;right:${Math.round(logoSize * 0.16)}px;
      width:${checkR * 2}px;height:${checkR * 2}px;border-radius:50%;background:#22c55e;
      display:flex;align-items:center;justify-content:center}
    .check svg{width:${Math.round(checkR * 1.2)}px;height:${Math.round(checkR * 1.2)}px}
    .title{font-size:${titleFs}px;font-weight:700;letter-spacing:.5px;color:#fff}
    .sub{font-size:${Math.round(titleFs * 0.6)}px;color:#94a3b8;font-weight:500}
  </style></head><body>
    <div class="center">
      <div class="logo">
        <span class="P">P</span>
        <span class="check">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12l4 4 10-10"/>
          </svg>
        </span>
      </div>
      <div class="title">Perito</div>
      <div class="sub">Peritaje vehicular profesional</div>
    </div>
  </body></html>`;
}

async function renderSplash(page, device, outFile) {
  const cssWidth = Math.round(device.width / device.dpr);
  const cssHeight = Math.round(device.height / device.dpr);
  await page.setViewport({
    width: cssWidth,
    height: cssHeight,
    deviceScaleFactor: device.dpr,
  });
  await page.setContent(buildSplashHtml(cssWidth, cssHeight), {
    waitUntil: "domcontentloaded",
  });
  await page.screenshot({ path: outFile, type: "png", fullPage: false });
  process.stdout.write(`  ${path.relative(process.cwd(), outFile)} ${device.width}x${device.height}\n`);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const meta = [];
    for (const d of DEVICES) {
      const outFile = path.join(OUT_DIR, `${d.name}.png`);
      await renderSplash(page, d, outFile);
      meta.push({
        src: `/icons/splash/${d.name}.png`,
        media: d.media,
        width: d.width,
        height: d.height,
      });
    }
    await fs.writeFile(
      path.join(OUT_DIR, "manifest-meta.json"),
      JSON.stringify(meta, null, 2),
      "utf8",
    );
  } finally {
    await browser.close();
  }
  process.stdout.write("\nListo. Splash screens en public/icons/splash/\n");
}

main().catch((err) => {
  console.error("Error generando splash:", err);
  process.exit(1);
});
