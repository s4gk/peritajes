# Plan: Perito 100% sin internet (PWA)

Rama: `feat/offline-first` (worktree en `/home/dev/perito-offline`, sale de `feat/mobile` @ 4793223).
Decisión de producto: **el PDF se genera en el servidor cuando vuelve la señal** (no en el celular).

## Objetivo

Con el celular en modo avión y la sesión iniciada previamente, el perito puede:
abrir la app → crear un peritaje nuevo o abrir uno existente → llenar todos los pasos
y tomar fotos → leer la tarjeta con el OCR local → firma del cliente en pantalla →
finalizar. Al volver la red todo sube solo y el PDF queda generado.

Sigue necesitando red (y debe decirlo con un mensaje claro, sin romperse): primer
login, firma remota por link, OCR con IA (cae al local), vista previa del PDF,
panel del dueño.

## Fases y criterios de aceptación

### Fase 1 — Abrir el wizard sin red (el bloqueo real)
Hoy `/inspection/[id]` es SSR force-dynamic por id y `router.push` hace fetch RSC
que el SW no atiende → offline cae en `offline.html`.
- [x] Que el wizard sea un shell que no dependa del id en el servidor (ej. leer el id
      en cliente con `useParams`/`location`, y que el SW sirva un shell cacheado para
      cualquier `/inspection/*`), o solución equivalente.
- [x] Navegación offline hacia el wizard funciona desde `/intake` (nuevo) y desde la
      lista `/peritajes` (existente): o el SW atiende las peticiones RSC con fallback,
      o se hace navegación dura cuando `!navigator.onLine`.
- [x] Precache en `install` del shell y de TODOS los chunks JS/CSS que necesita el
      wizard (leer manifiestos de build de Next), para que funcione offline aunque el
      perito nunca haya abierto el wizard con esa versión.
- [x] Sin fugas entre usuarios: el shell cacheado lleva datos del usuario (PanelShell);
      cerrar sesión (`wipeLocalUserData`) debe borrar caches del SW.

### Fase 2 — Datos y OCR disponibles offline
- [x] Con red, descargar completos (con fotos) los borradores abiertos del perito para
      que se puedan abrir offline (hoy la lista trae `partial`).
- [x] `navigator.storage.persist()` y manejo de `QuotaExceededError` con aviso.
- [x] Precache del OCR local (tesseract worker/core wasm + `/tessdata/spa.traineddata.gz`);
      offline usa el OCR local directo sin esperar timeouts.
- [x] `/api/owners/lookup` y cualquier fetch del wizard fallan en silencio offline.

### Fase 3 — Finalizar offline
- [x] Finalizar funciona offline; UI muestra "PDF pendiente: se genera al volver la señal".
- [x] Al sincronizar, el server asigna consecutivo y genera el PDF (verificar el camino
      del PUT con status completed que llega tarde).
- [x] Vista previa PDF y firma remota deshabilitadas offline con mensaje claro.

### Fase 4 — Robustez
- [ ] Sesión expirada al sincronizar (401/403): la cola NO se pierde; se pide re-login y
      se reintenta después.
- [ ] iOS no tiene Background Sync: sync al abrir/volver a foreground + aviso visible
      "tienes X peritajes sin subir".
- [ ] Conflictos: documentar y aplicar regla clara (hoy: server gana en filas sin
      mutación pendiente). No cambiar semántica sin dejarla escrita en el reporte.

### Fase 5 — Pruebas
- [ ] Tests unitarios (vitest) para la lógica nueva (cola, 401, helpers de SW si se extraen).
- [ ] Script E2E Puppeteer `scripts/e2e-offline.mjs` contra build de producción local
      (`next build && next start -p 3460` en el worktree, BD `perito_offline_e2e`):
      login → ir offline (`page.setOfflineMode(true)`) → crear peritaje → llenar datos
      mínimos + fotos → firma → finalizar → recargar offline (debe seguir ahí) → volver
      online → verificar en BD que subió, status completed y PDF generado.
- [ ] `npm run typecheck` y `npm run test` verdes.
- [ ] Bump de `VERSION` en `public/sw.js`.

## Fuera de alcance esta noche
Deploy a producción, merge a main/feat/mobile, push, app nativa, PDF en el celular.
