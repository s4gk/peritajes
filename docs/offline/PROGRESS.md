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
