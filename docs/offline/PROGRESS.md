# Progreso — Perito 100% sin internet

## Sesión 1 (2026-09-23, desde 04:36 CEST)
- Arranque: `npm ci` ok. BD `perito_offline_e2e` vacía (la app crea el esquema).
- Pool de pg configurable con `PG_POOL_MAX` (para E2E usar 3).

### Diagnóstico Fase 1 (reproducido con Puppeteer, `scripts/e2e-diag.mjs`)
- OJO: `page.setOfflineMode(true)` NO corta la red del service worker (otro target).
  Emularlo por CDP en el target del SW tampoco es fiable (el worker se reinicia).
  Solución: los scripts E2E manejan su propio server en :3460 y lo APAGAN para
  simular "sin red" (+ setOfflineMode para `navigator.onLine`). Ver `scripts/e2e-lib.mjs`.
- Resultado real antes del arreglo (perito logueado, SW controlando, luego sin red):
  - `/intake` nunca visitado → `offline.html` ("Sin conexión").
  - `/intake` visitado con red → Iniciar → URL `/inspection/9qslhptr` pero muestra `offline.html`
    (Next intenta el RSC, falla y hace navegación dura; el SW no tiene esa URL).
  - `/inspection/abc123` directo → `offline.html`.

### Fase 1 — HECHA (verificada con E2E)
- Wizard: `app/(panel)/inspection/[id]/page.tsx` ya no lee `params`; `components/wizard/wizard-from-url.tsx`
  toma el id de `usePathname()` (Next 14 inicializa el router desde `location.href`). Pinta
  "Cargando inspección..." hasta montar para no romper la hidratación del cascarón.
- SW v31: `SHELL_URL=/inspection/offline-shell` se sirve para cualquier `/inspection/*` sin red.
  `precacheNavigations()` + `precacheStaticAssets()` en `install` y en el mensaje `WARM_OFFLINE`.
- `/api/offline/manifest` (`lib/server/offline-manifest.ts`) lista `.next/static` + `public/tessdata`
  + `public/tesseract`, codificando `[id]`→`%5Bid%5D` (sin eso el chunk del wizard no se encontraba).
- `components/shared/offline-warmup.tsx` (en PanelShell) manda `WARM_OFFLINE` con el uid; el SW guarda
  un marcador `/__perito/offline-uid` y bota el cache runtime si entra otro usuario. `wipeLocalUserData`
  ya borraba `-runtime-`/`-api-` (el cascarón vive en runtime).
- `lib/client/offline-nav.ts` `navigateOfflineSafe`: sin red → evento `perito:before-hard-nav`
  (el wizard guarda lo del debounce) → `flushLocalWrites()` → navegación dura.
- Bugs de la cola encontrados por el E2E y arreglados (ver commit 15dd286): orden por peritaje,
  red/sesión no suman intentos, 404 recrea como borrador, Web Lock compartido con el SW.
- E2E `node scripts/e2e-offline.mjs` → 28/28 OK (05:20 CEST).

### Siguiente: Fase 2

### Fase 2 — HECHA (E2E 34/34, 05:45 CEST)
- OCR: `lib/ocr-assets.ts` + ruta `app/tesseract/[version]/[file]/route.ts` (lee node_modules, lista blanca).
  `createWorker` con `workerPath`/`corePath` propios y `workerBlobURL:false`. SW: cache `perito-ocr-<ver>`
  que sobrevive a los bumps; `WARM_OFFLINE` trae `ocrCore` (detectado con WebAssembly.validate,
  `lib/client/ocr-core.ts`) para bajar solo 1 core (~4 MB) + worker + lang pack (8,4 MB).
  Sin red, el escáner va directo a local (`prefersLocalOcr`). NOTA: el camino con
  `NEXT_PUBLIC_OCR_REMOTE=1` + sin red se revisó en código, el E2E corre con OCR remoto apagado.
- Borradores completos: `prefetchOwnDrafts(userId)` (desde OfflineWarmup) baja con fotos los borradores
  propios livianos (máx 15, más recientes). `ensureFullInspection` ya no pisa una copia local editada.
- `navigator.storage.persist()` al iniciar el store (no verificable en headless: Chrome decide por heurística).
- Cuota: `trackWrite` detecta `QuotaExceededError` → evento `perito:storage-full` → `StorageFullBanner`.
  En E2E se simula parcheando `IDBObjectStore.put` (la cuota emulada por CDP no se aplica a IDB en headless).
- Lookup de propietario y polling de wa-status no disparan sin red (ya tenían try/catch).

### Siguiente: Fase 3

### Fase 3 — HECHA (E2E 39/39, 06:00 CEST)
- `lib/client/use-online.ts` (useSyncExternalStore, `true` en server/hidratación) y
  `lib/client/use-pending-sync.ts` (¿hay cambios en cola para este peritaje?).
- "Pendiente de subir" = completed && sin consecutivo && con cambios en cola (no solo "sin consecutivo":
  hay finalizados viejos sin consecutivo). Resumen: banner "PDF pendiente: se genera al volver la señal"
  (con red: "Subiendo el peritaje…"). Encabezado del wizard: "Falta subirlo…" y "Consecutivo X".
- Sin red: "Previsualizar PDF", "Descargar PDF", "Firmar con QR" deshabilitados con texto; el panel de
  firma remota muestra "Firma remota no disponible sin señal" y no hace polling. Toast de finalizar sin red.
- Camino del PUT completed tardío: verificado en E2E (consecutivo + PDF en BD).
- E2E: `page.setOfflineMode` deja `navigator.onLine=true` tras navegar → `installOnlineOverride` lo fuerza
  con una bandera en sessionStorage (ver scripts/e2e-lib.mjs).

### Siguiente: Fase 4 (401 ya se maneja en la cola; falta UI de re-login, guardia al cerrar sesión, iOS)
