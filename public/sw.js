/* eslint-disable */
/**
 * Service worker para Peritajes del Llano (PWA offline-first).
 *
 * Estrategias de cache:
 *   - HTML / navigations: network-first, fallback a cache, fallback a /offline.html
 *   - /_next/static/*  : cache-first (assets con hash, inmutables)
 *   - GET /api/*       : stale-while-revalidate (última lista de peritajes
 *                        sigue accesible offline; sin ser canónica)
 *   - POST/PUT/DELETE  : passthrough — la queue de IDB se encarga del retry
 *
 * No usamos Workbox para mantener cero dependencias y poder leer el SW al
 * detalle. Cuando el archivo cambia, el browser reinstala porque versiona
 * por contenido (Next sirve sw.js desde /public con el hash en headers).
 */

// Bumpear VERSION cada vez que querramos invalidar caches viejos en todos los
// dispositivos (después de cambios grandes en el bundle, p.ej. reemplazo de
// Gemini OCR por Tesseract). En `activate` borramos los caches que no estén
// en la versión actual, así los chunks viejos se botan.
const VERSION = "v6";
const STATIC_CACHE = `perito-static-${VERSION}`;
const RUNTIME_CACHE = `perito-runtime-${VERSION}`;
const API_CACHE = `perito-api-${VERSION}`;
const OFFLINE_URL = "/offline.html";

// Rutas del panel que tratamos como "entry points" cuando el browser pide la
// start_url offline y no hay match exacto. Si alguna de estas está cacheada
// (porque el perito la visitó con red en algún momento), la servimos en vez
// del fallback offline.html. Orden = prioridad.
const NAVIGATION_FALLBACKS = [
  "/dashboard",
  "/peritajes",
  "/agenda",
  "/login",
];

// Lo mínimo que precacheamos en install — todo lo que el shell offline necesita
// ver bien (página de fallback, manifest y los íconos del install/standalone).
// Las páginas del panel se cachean en runtime al visitarlas mientras hay red;
// como son SSR con auth, precachearlas como anónimo nos guardaría un 307 inútil.
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Cacheamos individual: si una sola URL falla (p.ej. instalando offline
      // o con un asset todavía no copiado por Next), el install no se cae.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(url);
          } catch {
            /* ignore */
          }
        }),
      );
    })(),
  );
  // OJO: no llamamos skipWaiting() acá. Queremos que el SW nuevo quede en
  // estado `waiting` y que el cliente decida cuándo aplicar el update via
  // postMessage({type:"SKIP_WAITING"}) — ver handler de `message` más abajo.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => ![STATIC_CACHE, RUNTIME_CACHE, API_CACHE].includes(k))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// Recibe la señal del cliente cuando el usuario aprieta "Actualizar ahora"
// en el banner de update. Disparar skipWaiting hace que este SW pase de
// `waiting` a `activating` inmediatamente, y el cliente se entera por el
// evento `controllerchange` (manejado en pwa-update-prompt.tsx, que hace
// reload para servir el bundle nuevo).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isStaticAsset(url) {
  if (url.pathname.startsWith("/_next/static/")) return true;
  if (url.pathname.startsWith("/_next/data/")) return true;
  if (url.pathname === "/manifest.webmanifest") return true;
  if (url.pathname.startsWith("/icons/")) return true;
  // El lang pack de Tesseract pesa ~8MB — lo cacheamos como cualquier otro
  // asset estático para que el segundo escaneo no vuelva a bajarlo.
  if (url.pathname.startsWith("/tessdata/")) return true;
  if (/\.(png|jpg|jpeg|svg|webp|woff2?|ttf)$/i.test(url.pathname)) return true;
  return false;
}

function isApiGet(req, url) {
  return req.method === "GET" && url.pathname.startsWith("/api/");
}

/**
 * Hace un fetch con timeout duro. El default de fetch no tiene timeout y un
 * celular con señal débil puede quedar 30s "pensando" antes de fallar — lo
 * que el perito ve como "se trabó". 12s es suficiente para una página SSR
 * con red flaky y corto enough para no parecer congelado.
 */
function fetchWithTimeout(req, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(req, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function networkFirstNavigation(event) {
  const req = event.request;
  const cache = await caches.open(RUNTIME_CACHE);

  // Primer intento de red con timeout corto.
  let lastErr;
  try {
    const fresh = await fetchWithTimeout(req, 12_000);
    if (fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch (err) {
    lastErr = err;
  }

  // Segundo intento: si tenemos cache, lo servimos AHORA mientras la red
  // pelea en background. Si no hay cache, reintentamos la red una vez más
  // antes de tirar offline.html — los blips de celular son cortos y un
  // segundo intento con ~600ms de espera resuelve la mayoría de casos.
  let cached = await cache.match(req);
  if (cached) return cached;

  cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;

  const url = new URL(req.url);
  if (url.pathname === "/" || url.pathname === "") {
    for (const fallback of NAVIGATION_FALLBACKS) {
      cached = await cache.match(fallback);
      if (cached) return cached;
    }
  }

  cached = await cache.match(url.pathname);
  if (cached) return cached;

  // Sin cache, segundo intento de red — un mini-retry barato. Esto es lo que
  // resuelve el caso típico "celular con señal débil tira el primer fetch":
  // un retry de 8s con 500ms de buffer suele entregar la página real en vez
  // de mandar al perito a la pantalla "Sin conexión".
  try {
    await new Promise((r) => setTimeout(r, 500));
    const fresh = await fetchWithTimeout(req, 8_000);
    if (fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch {
    /* cae al offline */
  }

  const offline = await caches.match(OFFLINE_URL);
  if (offline) return offline;
  throw lastErr;
}

async function cacheFirst(event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const fresh = await fetch(event.request);
  if (fresh.ok) cache.put(event.request, fresh.clone()).catch(() => {});
  return fresh;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(event.request);
  const network = fetch(event.request)
    .then((res) => {
      if (res.ok) cache.put(event.request, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  return cached ?? (await network) ?? new Response("offline", { status: 503 });
}

/* -----------------------------------------------------------
 *  Background Sync — replay de la queue cuando el OS dice "hay red"
 * --------------------------------------------------------- */

const SYNC_TAG = "perito-flush-queue";
const IDB_NAME = "perito-offline";
const IDB_VERSION = 1;

function openMutationsDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // No bloqueamos upgrade: el cliente controla la schema. Si todavía no
    // existe la DB (primer uso del SW antes de que la app la cree), salimos
    // limpio sin hacer nada.
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // Crear stores mínimos para que el open no falle, igual el cliente los
      // recrea con la schema completa cuando arranque.
      if (!db.objectStoreNames.contains("mutations")) {
        const s = db.createObjectStore("mutations", {
          keyPath: "id",
          autoIncrement: true,
        });
        s.createIndex("by-inspection", "inspectionId");
      }
      if (!db.objectStoreNames.contains("inspections")) {
        db.createObjectStore("inspections", { keyPath: "id" });
      }
    };
  });
}

function idbGetAll(db, storeName) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    } catch (err) {
      // Store no existe todavía → tratamos como vacío.
      resolve([]);
    }
  });
}

function idbDelete(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbPut(db, storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Lee el token CSRF del cookie store — el middleware exige doble submit
 * (cookie + header). cookieStore es Chrome 87+ / Safari 17.4+; en navegadores
 * más viejos devolvemos null y el sync va a tirar 403, pero el cliente al
 * volver a abrirse retoma desde su propia queue así que el dato no se pierde.
 */
async function readCsrfToken() {
  try {
    if (self.cookieStore) {
      const c = await self.cookieStore.get("perito_csrf");
      return c?.value || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function notifyClientsSynced(inspection) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const c of clients) {
    c.postMessage({ type: "inspection-synced", inspection });
  }
}

async function replayMutation(mutation, csrf) {
  const headers = { "content-type": "application/json" };
  if (csrf) headers["x-csrf-token"] = csrf;
  try {
    if (mutation.kind === "create") {
      const res = await fetch("/api/inspections", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({ id: mutation.inspectionId, data: mutation.data }),
      });
      return { ok: res.ok || res.status === 409, status: res.status };
    }
    if (mutation.kind === "update") {
      const res = await fetch(
        `/api/inspections/${encodeURIComponent(mutation.inspectionId)}`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers,
          body: JSON.stringify({ data: mutation.data }),
        },
      );
      if (res.ok) {
        try {
          const json = await res.json();
          if (json && json.inspection) {
            notifyClientsSynced(json.inspection).catch(() => {});
          }
        } catch {
          /* ignore parse errors */
        }
        return { ok: true, status: res.status };
      }
      return { ok: false, status: res.status };
    }
    if (mutation.kind === "delete") {
      const res = await fetch(
        `/api/inspections/${encodeURIComponent(mutation.inspectionId)}`,
        { method: "DELETE", credentials: "same-origin", headers },
      );
      return { ok: res.ok || res.status === 404, status: res.status };
    }
    return { ok: false, status: 0 };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

async function flushPendingMutations() {
  let db;
  try {
    db = await openMutationsDb();
  } catch {
    return; // IDB no abierta — no hay nada que mandar.
  }
  try {
    const all = await idbGetAll(db, "mutations");
    if (!all || all.length === 0) return;
    all.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    const csrf = await readCsrfToken();
    for (const mutation of all) {
      const result = await replayMutation(mutation, csrf);
      if (result.ok) {
        if (mutation.id !== undefined) {
          await idbDelete(db, "mutations", mutation.id).catch(() => {});
        }
      } else {
        // Frenamos para no martillar el server. La próxima sync (o el cliente
        // al volver a abrirse) retoma desde acá.
        await idbPut(db, "mutations", {
          ...mutation,
          attempts: (mutation.attempts || 0) + 1,
          lastError: `${result.status}`,
        }).catch(() => {});
        break;
      }
    }
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushPendingMutations());
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Solo manejamos GET; el resto pasa directo (los POST/PUT/DELETE viven en
  // la queue de IDB).
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Solo same-origin. Recursos externos (Inter font, etc.) se dejan al browser.
  if (url.origin !== self.location.origin) return;

  // Las rutas /r/[token] devuelven PDF dinámico — no las cacheamos.
  if (url.pathname.startsWith("/r/")) return;
  // /api/pdf también es PDF dinámico.
  if (url.pathname.startsWith("/api/pdf")) return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirstNavigation(event));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(event));
    return;
  }
  if (isApiGet(req, url)) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }
});
