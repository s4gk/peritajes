// Helpers compartidos por los scripts E2E offline (Puppeteer).
//
// "Sin red" se simula de tres formas a la vez:
//   1. page.setOfflineMode(true): los fetch de la página fallan.
//   1b. navigator.onLine=false forzado (ver installOnlineOverride).
//   2. Se APAGA el server de pruebas: page.setOfflineMode NO afecta al service
//      worker (es otro target) y emularlo por CDP no es fiable porque el
//      worker se reinicia y pierde la emulación. Con el server abajo, todo
//      fetch del SW falla de verdad.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export const PORT = Number(process.env.E2E_PORT || 3460);
export const BASE = `http://localhost:${PORT}`;

let server = null;

export async function startServer() {
  if (server) return;
  server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, PG_POOL_MAX: "3", COOKIE_INSECURE: "true", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  server.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(`[next] ${d}`));
  server.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.status < 500) return;
    } catch {
      /* todavía arrancando */
    }
    await sleep(500);
  }
  throw new Error("El server de pruebas no arrancó");
}

export async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  try {
    process.kill(-s.pid, "SIGTERM");
  } catch {
    /* ya murió */
  }
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`${BASE}/api/health`);
    } catch {
      return;
    }
    await sleep(250);
  }
}

/**
 * Instalar UNA vez por página, antes de navegar. `page.setOfflineMode` deja
 * `navigator.onLine` en true tras navegar a otra página (probado: el documento
 * nuevo no hereda la emulación), así que lo forzamos con una bandera en
 * sessionStorage que sobrevive a las navegaciones de la pestaña.
 */
export async function installOnlineOverride(page) {
  await page.evaluateOnNewDocument(() => {
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(Navigator.prototype, "onLine", {
      configurable: true,
      get() {
        try {
          if (sessionStorage.getItem("__e2e_offline") === "1") return false;
        } catch {
          /* about:blank u origen opaco */
        }
        return desc.get.call(this);
      },
    });
  });
}

async function flagOffline(page, on) {
  await page
    .evaluate((on) => {
      sessionStorage.setItem("__e2e_offline", on ? "1" : "0");
      window.dispatchEvent(new Event(on ? "offline" : "online"));
    }, on)
    .catch(() => {});
}

export async function setOffline(page, on) {
  if (on) {
    await flagOffline(page, true);
    await page.setOfflineMode(true);
    await stopServer();
  } else {
    await startServer();
    await page.setOfflineMode(false);
    await flagOffline(page, false);
  }
}

export async function login(page, username, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  const status = await page.evaluate(async (u, p) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
    });
    return res.status;
  }, username, password);
  if (status !== 200) throw new Error(`login ${username} → ${status}`);
}

/** Espera a que el SW esté activo y controlando la página. La app puede
 *  recargar sola al tomar control el SW (controllerchange), así que toleramos
 *  que el contexto se destruya a mitad de camino. */
export async function waitForSw(page) {
  for (let i = 0; i < 20; i++) {
    try {
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      if (await page.evaluate(() => !!navigator.serviceWorker.controller)) return true;
      await page.reload({ waitUntil: "networkidle0" });
    } catch {
      await sleep(500);
    }
  }
  return false;
}

export const bodyText = (page, n = 400) =>
  page.evaluate((n) => document.body.innerText.slice(0, n), n);

export { sleep };

/** Abre un Radix Select por teclado y elige la primera opción. (El click de
 *  Puppeteer no siempre abre el Select: Radix escucha pointerdown.) */
export async function pickFirstOption(page, trigger) {
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("[role=option]", { timeout: 5000 });
  await sleep(300);
  await page.keyboard.press("Enter");
  await sleep(300);
}

/** Espera a que el SW deje la app lista sin red: cascarón del wizard en el
 *  cache runtime y todos los assets del manifiesto en el cache static. */
export async function waitForOfflineReady(page, timeoutMs = 60_000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await page.evaluate(async () => {
      const keys = await caches.keys();
      const runtimeKey = keys.find((k) => k.startsWith("perito-runtime-"));
      const staticKey = keys.find((k) => k.startsWith("perito-static-"));
      const shell = runtimeKey
        ? !!(await (await caches.open(runtimeKey)).match("/inspection/offline-shell"))
        : false;
      const man = await fetch("/api/offline/manifest").then((r) => r.json()).catch(() => ({ assets: [] }));
      let cached = 0;
      if (staticKey) {
        const c = await caches.open(staticKey);
        for (const a of man.assets) if (await c.match(a)) cached++;
      }
      // OCR: worker + 1 core + lang pack en su cache propio.
      let ocr = 0;
      if (man.ocr && keys.includes(man.ocr.cache)) {
        const c = await caches.open(man.ocr.cache);
        ocr = (await c.keys()).length;
      }
      return { shell, cached, total: man.assets.length, ocr };
    }).catch(() => last); // la app puede recargarse sola (controllerchange)
    if (last.shell && last.total > 0 && last.cached === last.total && last.ocr >= 3) return last;
    await sleep(1000);
  }
  throw new Error(`SW no quedó listo para offline: ${JSON.stringify(last)}`);
}
