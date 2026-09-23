// Diagnóstico Fase 1: ¿se puede abrir el wizard sin red?
// Uso: node scripts/e2e-diag.mjs   (arranca/para su propio server en :3460)
import puppeteer from "puppeteer";

import { BASE, bodyText, pickFirstOption, login, setOffline, sleep, startServer, stopServer, waitForSw } from "./e2e-lib.mjs";

const log = (...a) => console.log(...a);
await startServer();
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 900 });
try {
  await login(page, process.env.E2E_USER || "perito", process.env.E2E_PASS || "perito12345");
  await page.goto(`${BASE}/peritajes`, { waitUntil: "networkidle0" });
  log("SW controla:", await waitForSw(page));
  await sleep(1500);

  if (process.env.DIAG_VISIT_INTAKE) {
    await page.goto(`${BASE}/intake`, { waitUntil: "networkidle0" });
    await setOffline(page, true);
  } else {
    await setOffline(page, true);
    await page.goto(`${BASE}/intake`, { waitUntil: "load" }).catch((e) => log("goto intake err", e.message));
  }
  log("--- OFFLINE ---");
  log("A) /intake →", await page.title());
  const trigger = await page.$("button[role=combobox]");
  if (trigger) {
    await pickFirstOption(page, trigger);
    await (await page.$$("button[aria-pressed]"))[0].evaluate((b) => b.click());
    await sleep(300);
    const startBtn = await page.$("[data-tour=intake-start]");
    log("   start disabled?", await startBtn.evaluate((b) => b.disabled), "| trigger:", await trigger.evaluate((b) => b.innerText));
    await startBtn.evaluate((b) => b.click());
    await sleep(5000);
    log("B) tras Iniciar →", page.url(), "|", await page.title(), "|", JSON.stringify(await bodyText(page, 120)));
  } else {
    log("B) no hay formulario de intake (se sirvió offline.html)");
  }
  await page.goto(`${BASE}/inspection/abc123`, { waitUntil: "load" }).catch((e) => log("goto insp err", e.message));
  log("C) /inspection/abc123 →", await page.title(), "|", JSON.stringify(await bodyText(page, 120)));
} finally {
  await browser.close();
  await stopServer();
}
