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
// v20 (jul 2026): el deploy del rediseño de login + pilares v2 salió sin bump,
// dejando dispositivos con el bundle de junio cacheado (chunks que ya no
// existen en el server → login/SPA colgados). REGLA: todo deploy con cambios
// de bundle debe venir con bump de VERSION, si no los celulares con la PWA
// instalada nunca ven el banner de actualización.
const VERSION = "v20";
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

// Rutas de navegación que intentamos precachear en install pero que pueden
// fallar (307 a /login si no hay sesión, 500 si el server está reiniciándose).
// El install no se cae si fallan — el SW se instala igual, y el primer fetch
// con red cachea la página real para futuros offlines. Pero si el perito ya
// instaló la PWA con sesión activa, esto cubre el caso "abro la app por
// primera vez sin red apenas instalada".
const PRECACHE_NAVIGATIONS = [
  "/dashboard",
  "/intake",
  "/peritajes",
  "/agenda",
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
      // Pre-cache best-effort de las navegaciones más importantes. Usamos un
      // GET con credentials:include para enviar la cookie de sesión y traer
      // el HTML autenticado (no el 307 a /login). Si el server devuelve algo
      // distinto de 200, no lo metemos al cache — el runtime se encargará
      // cuando el perito visite la ruta con red. Esto reduce drásticamente
      // el caso "instalé y abro offline → pantalla blanca".
      const runtime = await caches.open(RUNTIME_CACHE);
      await Promise.all(
        PRECACHE_NAVIGATIONS.map(async (url) => {
          try {
            const res = await fetch(url, {
              credentials: "include",
              redirect: "manual",
            });
            if (res.ok && res.type !== "opaqueredirect") {
              await runtime.put(url, res.clone());
            }
          } catch {
            /* sin red durante install — el runtime se encarga después */
          }
        }),
      );
      // Tras instalar tomamos control inmediatamente para que la próxima
      // navegación use el bundle nuevo, no el caché del SW anterior.
      await self.skipWaiting();
    })(),
  );
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

/* -------------------------------------------------------------------------
 * Web Push
 *
 * El server llama `webpush.sendNotification(sub, payloadJSON)`. El payload
 * es JSON con { title, body, url, tag, icon }. Lo parseamos defensivamente:
 * si no es JSON válido (por ejemplo push de prueba sin payload), mostramos
 * una notificación genérica.
 *
 * `notificationclick` decide qué pestaña enfocar / abrir cuando el user
 * tappea la notif: si hay una ventana de la PWA abierta, la enfoca y navega
 * a `url`; si no, abre una nueva.
 * --------------------------------------------------------------------- */
self.addEventListener("push", (event) => {
  let data = { title: "Peritajes del Llano", body: "Tienes una notificación nueva." };
  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch {
      // Push sin payload JSON — usamos defaults.
      const text = event.data.text();
      if (text) data.body = text;
    }
  }
  const options = {
    body: data.body,
    icon: data.icon || "/icons/icon-192.png",
    badge: "/icons/favicon-32.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/dashboard" },
    // En iOS 16.4+ requireInteraction es ignorado pero no daña; en Android
    // mantiene la notif visible hasta que el user la atienda.
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Si ya hay una ventana abierta en cualquier ruta del panel, la
      // enfocamos y la navegamos al targetUrl en vez de abrir una pestaña
      // nueva — evita acumular tabs duplicadas.
      for (const client of clientsList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              /* ignore — algunas combinaciones no permiten navigate */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
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

// Endpoints autenticados cuya respuesta es ESPECÍFICA del usuario logueado
// (identidad, CSRF, listas por dueño/tenant). NUNCA deben cachearse en el SW:
// la clave de cache es solo la URL, así que un segundo usuario en el mismo
// navegador recibiría la identidad/datos del anterior servidos del cache —
// fue exactamente lo que hizo que peritajes hechos por un perito quedaran a
// nombre de otro. Estos van siempre a red (passthrough); offline, la app cae a
// su propio store de IndexedDB, que sí está aislado por registro.
function isUserSpecificApi(url) {
  return url.pathname.startsWith("/api/");
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

// Web Share Target: el manifest declara `share_target.action = /intake` con
// method POST + multipart. Cuando el user comparte una foto desde la cámara
// nativa hacia la PWA, el browser dispara un POST a /intake con las fotos
// en FormData. Lo interceptamos acá: leemos las fotos, las guardamos en un
// Cache temporal y redirigimos a /intake?shared=1 para que el cliente las
// recoja y arme el peritaje. Sin este handler, Next.js recibe un POST que
// no espera y devuelve 405.
const SHARE_CACHE = "perito-share-target";
async function handleShareTarget(request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return Response.redirect("/intake", 303);
  }
  const photos = formData.getAll("photos").filter((f) => f && f instanceof Blob);
  const cache = await caches.open(SHARE_CACHE);
  // Limpiamos shares previos para no acumular basura.
  const oldKeys = await cache.keys();
  await Promise.all(oldKeys.map((k) => cache.delete(k)));
  // Guardamos cada foto bajo /__shared/N con su content-type para que el
  // cliente la lea como Blob y la convierta a dataURL.
  for (let i = 0; i < photos.length; i++) {
    const blob = photos[i];
    const headers = new Headers();
    headers.set("content-type", blob.type || "image/jpeg");
    await cache.put(
      `/__shared/${i}`,
      new Response(blob, { headers }),
    );
  }
  return Response.redirect("/intake?shared=1", 303);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Share target: POST /intake con multipart. Lo interceptamos antes del
  // chequeo de método porque sí debe responderse.
  if (
    req.method === "POST" &&
    url.pathname === "/intake" &&
    url.origin === self.location.origin
  ) {
    event.respondWith(handleShareTarget(req));
    return;
  }
  // Solo manejamos GET; el resto pasa directo (los POST/PUT/DELETE viven en
  // la queue de IDB).
  if (req.method !== "GET") return;
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
    // Datos por-usuario → passthrough a red, jamás cache compartido (evita el
    // cruce de identidad entre usuarios en un mismo navegador).
    if (isUserSpecificApi(url)) return;
    event.respondWith(staleWhileRevalidate(event));
    return;
  }
});
