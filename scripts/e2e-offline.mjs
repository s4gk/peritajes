// E2E del modo sin internet (Puppeteer) contra un build de producción local.
//
//   npx next build && node scripts/e2e-offline.mjs
//
// Arranca y apaga su propio server en :3460 (ver e2e-lib.mjs: "sin red" =
// server apagado + page.setOfflineMode). Usa la BD de .env.local (debe ser
// perito_offline_e2e) y crea sus usuarios de prueba si faltan.
//
// Flujo:
//   1. Con red: login del perito, SW listo, crea un borrador A (existente).
//   2. Sin red: abre A desde /peritajes y lo edita; crea B desde /intake,
//      llena datos mínimos + fotos, firma en pantalla y finaliza.
//   3. Recarga sin red: B sigue ahí, finalizado.
//   4. Vuelve la red: todo sube solo; se verifica en la BD que A tiene la
//      edición y que B quedó completed con consecutivo y PDF.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";
import puppeteer from "puppeteer";
import sharp from "sharp";

import {
  BASE,
  bodyText,
  installOnlineOverride,
  login,
  pickFirstOption,
  setOffline,
  sleep,
  startServer,
  stopServer,
  waitForOfflineReady,
  waitForSw,
} from "./e2e-lib.mjs";

const PERITO = { username: "perito", password: "perito12345" };
const OUT_DIR = process.env.E2E_OUT || "/tmp/perito-e2e";

/* ------------------------------------------------------------------ util */

let stepNo = 0;
const results = [];
function step(name) {
  stepNo += 1;
  console.log(`\n[${stepNo}] ${name}`);
  return name;
}
function ok(msg) {
  console.log(`   ✔ ${msg}`);
  results.push({ ok: true, msg });
}
function fail(msg) {
  console.log(`   ✘ ${msg}`);
  results.push({ ok: false, msg });
  throw new Error(msg);
}
function check(cond, msg) {
  if (cond) ok(msg);
  else fail(msg);
}

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  const m = /^DATABASE_URL=(.+)$/m.exec(env);
  if (!m) throw new Error("DATABASE_URL no está en .env.local");
  return m[1].trim();
}

const DATABASE_URL = readDatabaseUrl();
if (!/\/perito_offline_e2e(\?|$)/.test(DATABASE_URL)) {
  throw new Error("Por seguridad el E2E solo corre contra la BD perito_offline_e2e");
}
const db = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });

async function api(pathname, { method = "GET", body, cookie } = {}) {
  const headers = { "content-type": "application/json" };
  if (cookie) {
    headers.cookie = cookie.header;
    if (cookie.csrf) headers["x-csrf-token"] = cookie.csrf;
  }
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  return { res, setCookies, json: await res.json().catch(() => null) };
}

function cookieJar(setCookies) {
  const kv = setCookies.map((c) => c.split(";")[0]);
  const csrf = kv.find((c) => c.startsWith("perito_csrf="))?.split("=")[1];
  return { header: kv.join("; "), csrf };
}

/** Crea admin → dueño → perito si no existen (idempotente). */
async function seedUsers() {
  const { json: setup } = await api("/api/auth/setup");
  if (setup?.needsSetup) {
    await api("/api/auth/setup", {
      method: "POST",
      body: { username: "admin", password: "admin12345", fullName: "Admin E2E", email: "admin@e2e.test" },
    });
  }
  const { rows } = await db.query("SELECT username FROM users WHERE username = ANY($1)", [
    ["dueno", "perito"],
  ]);
  const have = new Set(rows.map((r) => r.username));
  if (!have.has("dueno")) {
    const a = await api("/api/auth/login", { method: "POST", body: { username: "admin", password: "admin12345" } });
    await api("/api/users", {
      method: "POST",
      cookie: cookieJar(a.setCookies),
      body: { username: "dueno", password: "dueno12345", fullName: "Dueño E2E", email: "dueno@e2e.test", role: "owner", orgName: "Org E2E" },
    });
  }
  if (!have.has("perito")) {
    const o = await api("/api/auth/login", { method: "POST", body: { username: "dueno", password: "dueno12345" } });
    await api("/api/users", {
      method: "POST",
      cookie: cookieJar(o.setCookies),
      body: { username: "perito", password: "perito12345", fullName: "Perito E2E", email: "perito@e2e.test", role: "employee" },
    });
  }
  // Arrancamos limpios: peritajes de corridas anteriores del perito de prueba.
  await db.query(
    "DELETE FROM inspections WHERE user_id IN (SELECT id FROM users WHERE username IN ('perito', 'dueno'))",
  );
  // La firma del perito es requisito de cuenta (SignatureGate).
  const sig = await sharp({ create: { width: 60, height: 20, channels: 3, background: "#fff" } }).png().toBuffer();
  await db.query(
    "UPDATE users SET signature_data_url = $1 WHERE role <> 'admin' AND signature_data_url IS NULL",
    [`data:image/png;base64,${sig.toString("base64")}`],
  );
}

/** "Tarjeta de propiedad" sintética con texto, para que el OCR local tenga
 *  algo que leer. */
async function makeCard(file) {
  const lines = [
    "LICENCIA DE TRANSITO",
    "PLACA  BBB222",
    "MARCA  CHEVROLET",
    "LINEA  ONIX",
    "MODELO  2020",
    "COLOR  BLANCO",
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760">
    <rect width="100%" height="100%" fill="#ffffff"/>
    ${lines.map((l, i) => `<text x="60" y="${110 + i * 105}" font-family="DejaVu Sans, Arial, sans-serif" font-size="64" fill="#000">${l}</text>`).join("")}
  </svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(file);
  return file;
}

/** JPEG con ruido: pesa lo suficiente para pasar el chequeo de "foto usable". */
async function makePhoto(file, seed) {
  const w = 640;
  const h = 480;
  const buf = Buffer.alloc(w * h * 3);
  let x = seed * 7919 + 1;
  for (let i = 0; i < buf.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = x & 0xff;
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 70 }).toFile(file);
  return file;
}

async function clickByText(page, selector, re, { timeout = 10_000, trusted = false } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const handle = await page.evaluateHandle(
      (sel, src, flags) => {
        const rx = new RegExp(src, flags);
        return [...document.querySelectorAll(sel)].find(
          (el) => rx.test(el.innerText || el.textContent || "") && !el.disabled,
        ) || null;
      },
      selector,
      re.source,
      re.flags,
    );
    const el = handle.asElement();
    if (el) {
      await el.evaluate((b) => b.scrollIntoView({ block: "center" }));
      // `trusted`: click real del mouse (hace falta para abrir el selector de
      // archivos); si no, click sintético (inmune a overlays del tour).
      if (trusted) await el.click();
      else await el.evaluate((b) => b.click());
      return el;
    }
    await sleep(250);
  }
  throw new Error(`No encontré ${selector} con texto ${re}`);
}

async function waitForText(page, re, timeout = 15_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const txt = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    if (re.test(txt)) return true;
    await sleep(250);
  }
  return false;
}

async function typeInto(page, id, value) {
  const sel = `#${id}`;
  await page.waitForSelector(sel, { timeout: 10_000 });
  const tag = await page.$eval(sel, (el) => el.tagName);
  if (tag !== "INPUT" && tag !== "TEXTAREA") return false;
  await page.$eval(sel, (el) => el.scrollIntoView({ block: "center" }));
  await page.click(sel, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(sel, value);
  return true;
}

async function goToStep(page, labelRe) {
  // En celular el stepper es un menú: "Abrir lista de pasos" → paso.
  await page.$eval('button[aria-label="Abrir lista de pasos"]', (b) => b.click());
  await clickByText(page, "[role=dialog] button", labelRe);
  await sleep(600);
}

async function idbInspection(page, id) {
  return page.evaluate(async (id) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("perito-offline");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const get = (store, key) =>
      new Promise((res) => {
        const tx = db.transaction(store, "readonly");
        const r = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      });
    const insp = await get("inspections", id);
    const muts = (await get("mutations")) || [];
    db.close();
    return {
      insp: insp ? { status: insp.data?.status, plate: insp.data?.vehicle?.plate, owner: insp.data?.vehicle?.owner } : null,
      pending: muts.length,
    };
  }, id);
}

/* ------------------------------------------------------------------ main */

const { mkdirSync } = await import("node:fs");
mkdirSync(OUT_DIR, { recursive: true });
const photo1 = await makePhoto(path.join(OUT_DIR, "foto1.jpg"), 1);
const cardPhoto = await makeCard(path.join(OUT_DIR, "tarjeta.jpg"));

let browser;
let page;
let exitCode = 0;
const t0 = Date.now();
try {
  step("Server de pruebas + usuarios");
  await startServer();
  await seedUsers();
  ok("server arriba en :3460 y usuarios listos");

  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  page = await browser.newPage();
  await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: false });
  await installOnlineOverride(page);
  // Recorridos de bienvenida como ya vistos: tapan la pantalla y se roban clics.
  await page.evaluateOnNewDocument(() => {
    const paths = ["/dashboard", "/peritajes", "/agenda", "/vehiculos", "/propietarios", "/intake"];
    localStorage.setItem(
      "perito:tour:v1",
      JSON.stringify({ seen: ["admin", "owner", "employee", ...paths.map((p) => `section:${p}`)] }),
    );
  });
  if (process.env.E2E_DEBUG) {
    page.on("request", (r) => {
      if (r.url().includes("/api/inspections")) console.log("   [req]", r.method(), r.url().replace(BASE, ""));
    });
    page.on("response", (r) => {
      if (r.url().includes("/api/inspections")) console.log("   [res]", r.status(), r.request().method(), r.url().replace(BASE, ""));
    });
  }
  page.on("pageerror", (e) => console.log("   [pageerror]", page.url(), String(e).slice(0, 90)));

  step("Con red: login y service worker listo para trabajar sin red");
  await login(page, PERITO.username, PERITO.password);
  await page.goto(`${BASE}/peritajes`, { waitUntil: "networkidle0" });
  check(await waitForSw(page), "el SW controla la página");
  const ready = await waitForOfflineReady(page);
  ok(`cascarón del wizard, ${ready.cached}/${ready.total} assets y ${ready.ocr} archivos del OCR precacheados`);

  step("Con red: crear borrador A (será el 'existente')");
  await page.goto(`${BASE}/intake`, { waitUntil: "networkidle0" });
  await pickFirstOption(page, await page.waitForSelector("button[role=combobox]"));
  await (await page.$$("button[aria-pressed]"))[0].evaluate((b) => b.click());
  await sleep(200);
  await (await page.$("[data-tour=intake-start]")).evaluate((b) => b.click());
  await page.waitForFunction(() => /\/inspection\/[^/]+$/.test(location.pathname), { timeout: 15_000 });
  const idA = decodeURIComponent(new URL(page.url()).pathname.split("/")[2]);
  await page.waitForSelector("#plate", { timeout: 15_000 });
  await typeInto(page, "plate", "AAA111");
  await sleep(1500);
  // Esperamos a que suba (create + update).
  for (let i = 0; i < 40; i++) {
    const { rows } = await db.query("SELECT plate FROM inspections WHERE id = $1", [idA]);
    if (rows[0]?.plate === "AAA111") break;
    await sleep(500);
  }
  const { rows: rowsA0 } = await db.query("SELECT plate, status FROM inspections WHERE id = $1", [idA]);
  check(rowsA0[0]?.plate === "AAA111", `borrador A ${idA} está en la BD con placa AAA111`);

  step("Con red: un borrador con fotos hecho en OTRO dispositivo se baja completo");
  const other = await api("/api/auth/login", { method: "POST", body: PERITO });
  const cardDataUrl = `data:image/jpeg;base64,${readFileSync(photo1).toString("base64")}`;
  const idC = `e2e${Date.now().toString(36)}`;
  // Datos completos de un peritaje real (el A) como base.
  const { rows: baseRows } = await db.query("SELECT data FROM inspections WHERE id = $1", [idA]);
  const baseData = baseRows[0].data;
  const created = await api("/api/inspections", {
    method: "POST",
    cookie: cookieJar(other.setCookies),
    body: {
      id: idC,
      data: {
        ...baseData,
        vehicle: { ...baseData.vehicle, plate: "CCC333" },
        documents: { ownershipCardFront: [{ id: "f1", dataUrl: cardDataUrl }], ownershipCardBack: [] },
      },
    },
  });
  check(created.res.ok, `borrador C creado por API (HTTP ${created.res.status} ${created.res.ok ? "" : JSON.stringify(created.json)})`);
  // Recargar el panel = el perito abre la app con señal: baja el listado y
  // precarga completos sus borradores.
  await page.goto(`${BASE}/peritajes`, { waitUntil: "networkidle0" });
  let fullC = false;
  for (let i = 0; i < 60 && !fullC; i++) {
    fullC = await page.evaluate(async (id) => {
      const db = await new Promise((res) => { const r = indexedDB.open("perito-offline"); r.onsuccess = () => res(r.result); });
      const row = await new Promise((res) => { const r = db.transaction("inspections").objectStore("inspections").get(id); r.onsuccess = () => res(r.result); });
      db.close();
      return !!row && !row.partial && (row.data?.documents?.ownershipCardFront?.length ?? 0) > 0;
    }, idC);
    if (!fullC) await sleep(500);
  }
  check(fullC, "C quedó en el celular completo (con su foto), no la versión liviana");

  step("SIN RED: abrir el borrador A desde /peritajes");
  await setOffline(page, true);
  await page.goto(`${BASE}/peritajes`, { waitUntil: "load" });
  check(!/Sin conexión/.test(await page.title()), "/peritajes abre sin red (no offline.html)");
  check(await waitForText(page, /AAA111/), "la lista muestra el borrador A");
  // "Abrir" de la tarjeta que tiene la placa AAA111 (la lista trae varios).
  const opened = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button, a")].filter((b) => /^Abrir$/.test(b.innerText.trim()));
    for (const b of buttons) {
      let el = b;
      for (let i = 0; i < 8 && el; i++, el = el.parentElement) {
        if (/AAA111/.test(el.innerText) && !/CCC333/.test(el.innerText)) {
          b.click();
          return true;
        }
      }
    }
    return false;
  });
  check(opened, "botón Abrir de A encontrado");
  await page.waitForFunction((id) => location.pathname === `/inspection/${id}`, { timeout: 20_000 }, idA);
  await page.waitForSelector("#owner", { timeout: 20_000 });
  check(true, "el wizard de A abrió sin red");
  await typeInto(page, "owner", "Cliente Offline A");
  await sleep(800);
  await clickByText(page, "button", /Volver a peritajes/);
  await page.waitForFunction(() => location.pathname === "/peritajes", { timeout: 20_000 });
  if (process.env.E2E_DEBUG) {
    console.log(await page.evaluate(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open("perito-offline"); r.onsuccess = () => res(r.result); });
      const all = await new Promise((res) => { const r = db.transaction("inspections").objectStore("inspections").getAll(); r.onsuccess = () => res(r.result); });
      const muts = await new Promise((res) => { const r = db.transaction("mutations").objectStore("mutations").getAll(); r.onsuccess = () => res(r.result); });
      return JSON.stringify({ all: all.map((i) => [i.id, i.data.vehicle.plate, i.data.vehicle.owner, !!i.partial]), muts: muts.map((m) => [m.kind, m.inspectionId]) });
    }));
  }
  const afterA = await idbInspection(page, idA);
  check(afterA.insp?.owner?.toUpperCase() === "CLIENTE OFFLINE A", "la edición de A quedó guardada en el celular");

  step("SIN RED: abrir C (bajado de otro dispositivo) muestra su foto");
  await page.goto(`${BASE}/inspection/${idC}`, { waitUntil: "load" });
  await page.waitForSelector("#plate", { timeout: 20_000 });
  const cImg = await page
    .waitForFunction(
      () => [...document.querySelectorAll('img[alt="Tarjeta de propiedad — Frente"]')].some((i) => i.src.startsWith("data:image")),
      { timeout: 10_000 },
    )
    .then(() => true)
    .catch(() => false);
  check(cImg, "la foto de la tarjeta de C se ve sin red");
  await page.goto(`${BASE}/peritajes`, { waitUntil: "load" });

  if (process.env.E2E_DEBUG) console.log("   navigator.onLine (C) =", await page.evaluate(() => navigator.onLine));
  step("SIN RED: crear peritaje B desde /intake");
  await clickByText(page, "button, a", /Nuevo peritaje|Nuevo/);
  await page.waitForFunction(() => location.pathname === "/intake", { timeout: 20_000 });
  await pickFirstOption(page, await page.waitForSelector("button[role=combobox]"));
  await (await page.$$("button[aria-pressed]"))[0].evaluate((b) => b.click());
  await sleep(200);
  await (await page.$("[data-tour=intake-start]")).evaluate((b) => b.click());
  await page.waitForFunction(() => /\/inspection\/[^/]+$/.test(location.pathname), { timeout: 20_000 });
  const idB = decodeURIComponent(new URL(page.url()).pathname.split("/")[2]);
  await page.waitForSelector("#plate", { timeout: 20_000 });
  ok(`wizard de B (${idB}) abierto sin red`);

  step("SIN RED: datos mínimos del vehículo");
  const fields = {
    plate: "BBB222",
    make: "Chevrolet",
    model: "Onix",
    year: "2020",
    mileage: "45000",
    owner: "Cliente Offline B",
    ownerDocument: "1234567",
    ownerPhone: "3001234567",
    fasecoldaValue: "50000000",
    fasecoldaCode: "01601234",
    llanoValue: "48000000",
  };
  for (const [id, v] of Object.entries(fields)) {
    if (!(await typeInto(page, id, v))) console.log(`   (campo ${id} no es input, se omite)`);
  }
  ok("campos llenados");

  step("SIN RED: fotos de la tarjeta (frente con OCR local, reverso)");
  for (const [label, done, file] of [
    [/Capturar reverso/, /Guardar reverso/, photo1],
    [/Escanear frente/, /Aplicar datos|Guardar foto|Usar la foto/, cardPhoto],
  ]) {
    await clickByText(page, "button", label);
    await sleep(500);
    const [chooser] = await Promise.all([
      page.waitForFileChooser({ timeout: 10_000 }),
      clickByText(page, "[role=dialog] button", /Subir desde galer/, { trusted: true }),
    ]);
    await chooser.accept([file]);
    if (file === cardPhoto) {
      // El OCR local tiene que correr sin red: o detecta campos o dice que no
      // detectó nada — pero NO "No se pudo procesar la imagen" (motor caído).
      const t = Date.now();
      let dialogText = "";
      while (Date.now() - t < 90_000) {
        dialogText = await page.$eval("[role=dialog]", (d) => d.innerText).catch(() => "");
        if (/Aplicar datos|No detecté|No se pudo procesar/.test(dialogText)) break;
        await sleep(500);
      }
      check(!/No se pudo procesar/.test(dialogText) && /Aplicar datos|No detecté/.test(dialogText),
        `el OCR local corrió sin red (${Math.round((Date.now() - t) / 1000)}s)`);
      console.log("   OCR →", JSON.stringify(dialogText.replace(/\s+/g, " ").slice(0, 300)));
    }
    await clickByText(page, "[role=dialog] button", done, { timeout: 90_000 });
    await sleep(600);
  }
  const cardOk = await page.evaluate(() => document.querySelectorAll('img[alt^="Tarjeta de propiedad"]').length);
  check(cardOk === 2, "frente y reverso de la tarjeta capturados");

  step("SIN RED: 6 fotos obligatorias");
  await goToStep(page, /Fotografías adicionales/);
  await page.waitForSelector("input[type=file][multiple]", { timeout: 10_000 });
  for (let i = 0; i < 6; i++) {
    const inputs = await page.$$("input[type=file][multiple]");
    await inputs[i].uploadFile(photo1);
    await sleep(900);
  }
  check(await waitForText(page, /1 foto/), "fotos obligatorias cargadas");

  step("SIN RED: conclusión, firma del cliente en pantalla y finalizar");
  await goToStep(page, /Resumen y conclusión/);
  await page.waitForSelector("input[id^=pillar-]", { timeout: 10_000 });
  for (const h of await page.$$("input[id^=pillar-]")) {
    await h.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await h.click({ clickCount: 3 });
    await h.type("90");
  }
  // Condición general y (si está activo) concepto de asegurabilidad: Selects de Radix.
  const combos = await page.$$("button[role=combobox]");
  for (const c of combos) await pickFirstOption(page, c);
  if (process.env.E2E_DEBUG) console.log("   navigator.onLine =", await page.evaluate(() => navigator.onLine));
  const offlineUi = await page.evaluate(() => {
    const btn = (re) => [...document.querySelectorAll("button")].find((b) => re.test(b.innerText));
    return {
      preview: btn(/Previsualizar PDF/)?.disabled ?? null,
      qr: btn(/Firmar con QR/)?.disabled ?? null,
      remoteMsg: /Firma remota no disponible sin señal/.test(document.body.innerText),
      previewMsg: /vista previa del PDF necesita internet/.test(document.body.innerText),
    };
  });
  check(offlineUi.preview === true && offlineUi.previewMsg, "sin red, 'Previsualizar PDF' está deshabilitado y lo explica");
  check(offlineUi.qr === true && offlineUi.remoteMsg, "sin red, firma por QR y link remoto deshabilitados con mensaje");
  await clickByText(page, "button", /Firmar en esta pantalla/);
  // El canvas del pad de firma (el resumen tiene otros canvas de gráficos).
  await page.waitForSelector("canvas.touch-none", { timeout: 10_000 });
  const canvas = (await page.$$("canvas.touch-none")).pop();
  await canvas.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await sleep(800); // por si el scroll es suave
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(box.x + 20 + i * 10, box.y + box.height / 2 + (i % 2 ? 15 : -15));
  }
  await page.mouse.up();
  await sleep(300);
  if (process.env.E2E_DEBUG) await page.screenshot({ path: path.join(OUT_DIR, "firma.png") });
  // Algunos pads piden confirmar la firma.
  await clickByText(page, "button", /^(Usar firma|Guardar firma|Confirmar)$/, { timeout: 1500 }).catch(() => {});
  check(await waitForText(page, /Firma del cliente registrada/, 5000), "firma del cliente registrada");
  await clickByText(page, "button", /Finalizar peritaje/);
  await clickByText(page, "[role=dialog] button", /Sí, finalizar/);
  check(await waitForText(page, /Peritaje finalizado/), "la UI muestra 'Peritaje finalizado'");
  check(await waitForText(page, /PDF pendiente: se genera al volver la señal/), "la UI avisa 'PDF pendiente: se genera al volver la señal'");
  await sleep(1200);
  const localB = await idbInspection(page, idB);
  check(localB.insp?.status === "completed", "B quedó completed en el celular");
  check(localB.pending > 0, `hay ${localB.pending} cambios esperando señal`);
  await page.screenshot({ path: path.join(OUT_DIR, "finalizado-offline.png"), fullPage: false });

  step("SIN RED: recargar — B sigue ahí");
  await page.reload({ waitUntil: "load" });
  check(!/Sin conexión/.test(await page.title()), "la recarga sin red no cae en offline.html");
  check(await waitForText(page, /BBB222/, 20_000), "el wizard recargado muestra la placa BBB222");
  const { rows: preB } = await db.query("SELECT id FROM inspections WHERE id = $1", [idB]);
  check(preB.length === 0, "B todavía NO está en la BD (no hubo red)");

  step("VUELVE LA RED: sincroniza solo");
  await setOffline(page, false);
  let rowB = null;
  for (let i = 0; i < 120; i++) {
    const { rows } = await db.query(
      "SELECT status, report_number, pdf_path, pdf_size, locked_at FROM inspections WHERE id = $1",
      [idB],
    );
    rowB = rows[0] ?? null;
    if (rowB?.status === "completed" && rowB?.pdf_path) break;
    await sleep(1000);
  }
  check(rowB?.status === "completed", `B subió con status completed`);
  check(!!rowB?.report_number, `B tiene consecutivo ${rowB?.report_number}`);
  check(!!rowB?.pdf_path && rowB.pdf_size > 0, `PDF generado (${rowB?.pdf_size} bytes)`);
  const { rows: rowsA } = await db.query("SELECT data->'vehicle'->>'owner' AS owner FROM inspections WHERE id = $1", [idA]);
  check(rowsA[0]?.owner?.toUpperCase() === "CLIENTE OFFLINE A", "la edición offline de A llegó a la BD");
  check(await waitForText(page, new RegExp(rowB?.report_number ?? "PER-"), 30_000), "sin recargar, la pantalla muestra el consecutivo");
  check(!(await waitForText(page, /PDF pendiente/, 1000)), "el aviso de PDF pendiente desaparece");
  const finalState = await idbInspection(page, idB);
  check(finalState.pending === 0, "la cola del celular quedó vacía");

  step("Sin fugas entre usuarios: cerrar sesión y entrar con otro");
  const cacheInfo = () =>
    page.evaluate(async () => {
      const keys = await caches.keys();
      const rk = keys.find((k) => k.startsWith("perito-runtime-"));
      if (!rk) return { runtime: false };
      const c = await caches.open(rk);
      const shell = await c.match("/inspection/offline-shell");
      const marker = await c.match("/__perito/offline-uid");
      return {
        runtime: true,
        shellUser: shell ? /Perito E2E/.test(await shell.text()) ? "perito" : "otro" : null,
        marker: marker ? await marker.text() : null,
      };
    });
  check((await cacheInfo()).shellUser === "perito", "antes de salir, el cascarón cacheado es del perito");
  await page.goto(`${BASE}/peritajes`, { waitUntil: "networkidle0" });
  await clickByText(page, "button", /Salir/);
  await page.waitForFunction(() => location.pathname === "/login", { timeout: 20_000 });
  const afterLogout = await cacheInfo();
  check(!afterLogout.runtime || afterLogout.shellUser === null, "al cerrar sesión se borró el HTML cacheado (cascarón)");
  const idbAfter = await page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open("perito-offline"); r.onsuccess = () => res(r.result); });
    const n = await new Promise((res) => { const r = db.transaction("inspections").objectStore("inspections").count(); r.onsuccess = () => res(r.result); });
    db.close();
    return n;
  });
  check(idbAfter === 0, "al cerrar sesión se borraron los peritajes locales");
  await login(page, "dueno", "dueno12345");
  await page.goto(`${BASE}/peritajes`, { waitUntil: "networkidle0" });
  await waitForOfflineReady(page);
  const { rows: duenoRows } = await db.query("SELECT id FROM users WHERE username = 'dueno'");
  const second = await cacheInfo();
  check(second.shellUser === "otro" && second.marker === duenoRows[0].id, "el cascarón nuevo es del dueño (no hereda al perito)");

  step("Celular sin espacio: la app avisa en vez de perder el cambio en silencio");
  await page.goto(`${BASE}/intake`, { waitUntil: "networkidle0" });
  await pickFirstOption(page, await page.waitForSelector("button[role=combobox]"));
  await (await page.$$("button[aria-pressed]"))[0].evaluate((b) => b.click());
  await sleep(200);
  await (await page.$("[data-tour=intake-start]")).evaluate((b) => b.click());
  await page.waitForSelector("#plate", { timeout: 20_000 });
  // Chrome headless no hace cumplir la cuota emulada por CDP en IndexedDB
  // (probado: escribe 8 MB con cuota de 20 KB), así que simulamos lo que ve
  // la app cuando el disco se llena: put() lanza QuotaExceededError.
  await page.evaluate(() => {
    const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "inspections") throw new DOMException("Sin espacio", "QuotaExceededError");
      return orig.apply(this, args);
    };
  });
  await goToStep(page, /Fotografías adicionales/);
  await page.waitForSelector("input[type=file][multiple]", { timeout: 10_000 });
  await (await page.$$("input[type=file][multiple]"))[0].uploadFile(photo1);
  check(await waitForText(page, /se quedó sin espacio/, 15_000), "aparece el aviso 'El celular se quedó sin espacio'");
} catch (err) {
  exitCode = 1;
  console.error("\nFALLÓ:", err?.message ?? err);
  if (page) await page.screenshot({ path: path.join(OUT_DIR, "fallo.png") }).catch(() => {});
  if (page && process.env.E2E_DEBUG) {
    console.error("Cola en IDB:", await page.evaluate(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open("perito-offline"); r.onsuccess = () => res(r.result); });
      const muts = await new Promise((res) => { const r = db.transaction("mutations").objectStore("mutations").getAll(); r.onsuccess = () => res(r.result); });
      return JSON.stringify(muts.map((m) => ({ id: m.id, kind: m.kind, insp: m.inspectionId, status: m.data?.status, attempts: m.attempts, lastError: m.lastError })));
    }).catch((e) => String(e)));
  }
  if (page) console.error("Texto en pantalla:", JSON.stringify(await bodyText(page, 600).catch(() => "")));
} finally {
  await browser?.close().catch(() => {});
  await stopServer();
  await db.end().catch(() => {});
  const passed = results.filter((r) => r.ok).length;
  const summary = `${exitCode === 0 ? "OK" : "FALLÓ"} — ${passed} verificaciones pasaron, ${results.length - passed} fallaron (${Math.round((Date.now() - t0) / 1000)}s)`;
  console.log(`\n${summary}`);
  writeFileSync(path.join(OUT_DIR, "resultado.json"), JSON.stringify({ summary, results }, null, 2));
  process.exit(exitCode);
}
