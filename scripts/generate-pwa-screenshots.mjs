#!/usr/bin/env node
/**
 * Genera screenshots para el install prompt del manifest.
 *
 *   node scripts/generate-pwa-screenshots.mjs
 *
 * Renderiza HTML mockup con la paleta de Perito (slate-900 / inter) para
 * mostrar la UI principal. Estos PNG aparecen en el install prompt de Chrome
 * en Android — sin ellos el banner sale "pelado" sin previews.
 */

import puppeteer from "puppeteer";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "public", "screenshots");

const BASE_STYLES = `
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;font-family:Inter,'Helvetica Neue',Arial,sans-serif;background:#f1f5f9;color:#0f172a;-webkit-font-smoothing:antialiased}
  .topbar{background:#0f172a;color:#fff;padding:14px 18px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b}
  .topbar .logo{width:28px;height:28px;background:#0f172a;border:1px solid #334155;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:13px}
  .topbar .title{font-weight:700;font-size:15px}
  .topbar .pill{margin-left:auto;font-size:11px;background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.3);padding:3px 8px;border-radius:999px}
  .page{padding:18px}
  .h1{font-size:22px;font-weight:700;letter-spacing:-0.3px;margin:0 0 4px}
  .sub{color:#64748b;font-size:13px;margin:0 0 14px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
  .val{font-size:20px;font-weight:700;color:#0f172a;margin-top:4px}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}
  .badge-warn{background:rgba(245,158,11,.12);color:#92400e;border:1px solid rgba(245,158,11,.4)}
  .badge-ok{background:rgba(34,197,94,.12);color:#166534;border:1px solid rgba(34,197,94,.4)}
  .badge-danger{background:rgba(220,38,38,.12);color:#991b1b;border:1px solid rgba(220,38,38,.4)}
  .badge-neutral{background:#f1f5f9;color:#475569;border:1px solid #e2e8f0}
  .plate{display:inline-flex;align-items:center;font-family:'Roboto Mono',monospace;font-size:14px;font-weight:700;border:1px solid #cbd5e1;background:#fff;padding:4px 10px;border-radius:6px;letter-spacing:1px}
  .row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f1f5f9}
  .row:last-child{border-bottom:none}
  .row-meta{font-size:12px;color:#64748b}
  .btn{display:inline-flex;align-items:center;gap:6px;background:#0f172a;color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;border:none}
  .btn-out{background:#fff;color:#0f172a;border:1px solid #cbd5e1}
  .section-title{font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin:18px 0 8px}
  .sidebar{background:#fff;border-right:1px solid #e2e8f0;width:240px;min-height:100vh;padding:12px}
  .sidebar .item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;color:#475569;font-size:14px;font-weight:500}
  .sidebar .item.active{background:#0f172a;color:#fff}
  .sidebar .item .dot{width:6px;height:6px;border-radius:50%;background:currentColor}
  .layout{display:flex;min-height:100vh}
  .main{flex:1}
  .findings li{padding:8px 10px;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;list-style:none;margin-bottom:6px;font-size:12.5px;color:#991b1b}
  .findings li.warn{border-color:#fde68a;background:#fffbeb;color:#92400e}
`;

const MOBILE_DASHBOARD = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_STYLES}</style></head><body>
  <div class="topbar">
    <span class="logo">P</span>
    <span class="title">Perito</span>
    <span class="pill">● En línea</span>
  </div>
  <div class="page">
    <h1 class="h1">Dashboard</h1>
    <p class="sub">Resumen operativo de tus peritajes</p>
    <div class="grid-3" style="margin-bottom:12px">
      <div class="card"><div class="label">Mes actual</div><div class="val">38</div></div>
      <div class="card"><div class="label">Finalizados</div><div class="val">31</div></div>
      <div class="card"><div class="label">Riesgo alto</div><div class="val" style="color:#dc2626">4</div></div>
    </div>
    <div class="section-title">Últimos peritajes</div>
    <div class="card">
      <div class="row">
        <span class="plate">ABC-123</span>
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">Mazda 3 · 2019</div>
          <div class="row-meta">PER-2026-0042 · hace 2 horas</div>
        </div>
        <span class="badge badge-ok">Bajo</span>
      </div>
      <div class="row">
        <span class="plate">XYZ-789</span>
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">Chevrolet Sail · 2017</div>
          <div class="row-meta">PER-2026-0041 · ayer</div>
        </div>
        <span class="badge badge-warn">Medio</span>
      </div>
      <div class="row">
        <span class="plate">KLM-456</span>
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">Renault Sandero · 2015</div>
          <div class="row-meta">PER-2026-0040 · ayer</div>
        </div>
        <span class="badge badge-danger">Alto</span>
      </div>
    </div>
  </div>
</body></html>`;

const MOBILE_WIZARD = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_STYLES}</style></head><body>
  <div class="topbar">
    <span class="logo">P</span>
    <span class="title">Peritaje · ABC-123</span>
    <span class="pill">Paso 4/9</span>
  </div>
  <div class="page">
    <h1 class="h1" style="font-size:18px">Carrocería · Recorrido</h1>
    <p class="sub">Capot · Punta delantera izquierda · Guarda polvo · Torre…</p>

    <div class="card" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px">
        <strong style="font-size:14px">Capot</strong>
        <span class="badge badge-ok" style="margin-left:auto">OK</span>
      </div>
      <div class="row-meta" style="margin-top:4px">Estado original · sin hallazgos</div>
    </div>

    <div class="card" style="margin-bottom:10px;border-color:#fde68a">
      <div style="display:flex;align-items:center;gap:8px">
        <strong style="font-size:14px">Guarda Fangos Delantero Izquierdo</strong>
        <span class="badge badge-warn" style="margin-left:auto">Repintado</span>
      </div>
      <div class="row-meta" style="margin-top:4px">2 fotos · "Repinte parcial detectado por brillo"</div>
    </div>

    <div class="card">
      <div style="display:flex;align-items:center;gap:8px">
        <strong style="font-size:14px">Torre Delantera Izquierda</strong>
        <span class="badge badge-danger" style="margin-left:auto">Reparada</span>
      </div>
      <div class="row-meta" style="margin-top:4px">3 fotos · soldadura visible en interior</div>
    </div>

    <div style="margin-top:14px;display:flex;gap:8px">
      <button class="btn btn-out">Atrás</button>
      <button class="btn" style="margin-left:auto">Siguiente</button>
    </div>
  </div>
</body></html>`;

const WIDE_PANEL = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_STYLES}</style></head><body>
  <div class="layout">
    <aside class="sidebar">
      <div style="display:flex;align-items:center;gap:8px;padding:6px 10px 14px;border-bottom:1px solid #e2e8f0;margin-bottom:10px">
        <span class="logo" style="border-color:#0f172a">P</span>
        <strong style="font-size:15px">Perito</strong>
      </div>
      <div class="item active"><span class="dot"></span> Dashboard</div>
      <div class="item"><span class="dot"></span> Agenda</div>
      <div class="item"><span class="dot"></span> Peritajes</div>
      <div class="item"><span class="dot"></span> Vehículos</div>
      <div class="item"><span class="dot"></span> Empresa</div>
      <div class="item"><span class="dot"></span> Usuarios</div>
      <div class="item"><span class="dot"></span> Auditoría</div>
    </aside>
    <main class="main">
      <div class="topbar" style="padding:12px 28px">
        <strong>Panel · Vestel Peritajes</strong>
        <span class="pill" style="margin-left:auto">● 32 cambios sincronizados</span>
      </div>
      <div class="page" style="padding:28px">
        <h1 class="h1">Resumen del mes</h1>
        <p class="sub">Mayo 2026 · 7 peritos activos · 12 citas programadas</p>
        <div class="grid-3" style="margin-bottom:18px">
          <div class="card"><div class="label">Peritajes mes</div><div class="val">182</div><div class="row-meta">↑ 14% vs abril</div></div>
          <div class="card"><div class="label">Tiempo promedio</div><div class="val">38 min</div><div class="row-meta">↓ 6 min</div></div>
          <div class="card"><div class="label">Hallazgos críticos</div><div class="val" style="color:#dc2626">19</div><div class="row-meta">en 12 vehículos</div></div>
        </div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <strong>Hallazgos frecuentes esta semana</strong>
            <span class="badge badge-neutral">38 peritajes</span>
          </div>
          <ul class="findings" style="margin:0;padding:0">
            <li class="warn">Sellante de puertas alterado (12 vehículos)</li>
            <li>Soldadura visible en torre delantera (7 vehículos)</li>
            <li class="warn">Repinte total carrocería detectado (5 vehículos)</li>
            <li>Discrepancia VIN vs RUNT (2 vehículos)</li>
          </ul>
        </div>
      </div>
    </main>
  </div>
</body></html>`;

async function renderShot(page, html, viewport, outFile) {
  await page.setViewport(viewport);
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: outFile, type: "png", fullPage: false });
  process.stdout.write(`  ${path.relative(process.cwd(), outFile)} ${viewport.width}x${viewport.height}\n`);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    // Tamaños recomendados por la spec: narrow (mobile) y wide (desktop).
    await renderShot(
      page,
      MOBILE_DASHBOARD,
      { width: 412, height: 892, deviceScaleFactor: 1 },
      path.join(OUT_DIR, "mobile-dashboard.png"),
    );
    await renderShot(
      page,
      MOBILE_WIZARD,
      { width: 412, height: 892, deviceScaleFactor: 1 },
      path.join(OUT_DIR, "mobile-wizard.png"),
    );
    await renderShot(
      page,
      WIDE_PANEL,
      { width: 1280, height: 720, deviceScaleFactor: 1 },
      path.join(OUT_DIR, "wide-panel.png"),
    );
  } finally {
    await browser.close();
  }
  process.stdout.write("\nListo. Screenshots en public/screenshots/\n");
}

main().catch((err) => {
  console.error("Error generando screenshots:", err);
  process.exit(1);
});
