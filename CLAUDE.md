# CLAUDE.md

Guía para trabajar en **Perito**: PWA de peritajes vehiculares (Next.js 14 App Router + Postgres), offline-first y multi-tenant. Producto de Vestel.

## Comandos

```bash
npm run dev            # dev server (http)
npm run dev:https      # dev con HTTPS en 0.0.0.0:3457 (necesario para cámara en celulares)
npm run build          # build de producción
npm run start:https    # server.js (prod local)
npm run lint           # next lint (eslint + next/core-web-vitals)
npm run typecheck      # tsc --noEmit
npm run test           # vitest run (suite completa)
npm run test:watch     # vitest en watch
```

- **Antes de dar algo por terminado corre `npm run typecheck` y `npm run test`.** Ambos deben quedar verdes.
- Deploy en prod: **pm2** vía `ecosystem.config.js` (app `perito`, `server.js`, puerto 3100).
- Preview del PDF a mano (no corre en la suite): `PREVIEW_OUT=/tmp/perito-preview.html npx vitest run tests/_preview.gen.test.ts`. Los archivos `*.gen.test.ts` son generadores, no tests con asserts; están excluidos de `npm run test`.

## Arquitectura

App Router con dos grandes zonas:
- **`app/(panel)/`** — panel web para peritos/owners/admin (dashboard, agenda, clientes, vehículos, propietarios, usuarios, auditoría, whatsapp, intake).
- **Wizard de inspección** (`components/wizard/`) — flujo paso a paso de captura del peritaje, pensado para celular y **offline-first**.
- **`app/api/`** — 45 route handlers. **`app/r/[token]`** y **`app/sign`** son los flujos públicos (firma remota por link).

### Datos y persistencia
- **Postgres** vía `pg` (`lib/server/db.ts`, pool singleton). `DATABASE_URL` es obligatorio.
- **Migraciones idempotentes** ejecutadas una vez por proceso con `ensureMigrated()` — no hay tool de migraciones aparte; el SQL vive en `db.ts`.
- **Offline-first en cliente:** IndexedDB (`idb`) + cola de sincronización en `lib/client/sync-queue.ts`. Los peritajes se crean/editan offline y se sincronizan al recuperar conexión.

### Multi-tenancy y roles (`lib/server/auth.ts`)
Tres roles, jerarquía por organización (tenant):
- **`admin`** — superuser técnico (Vestel), sin org, ve todo, único que crea owners.
- **`owner`** — dueño del negocio; ve todos los peritajes de SU org (propios + empleados), gestiona empleados/empresa/WhatsApp.
- **`employee`** — perito asalariado; solo ve/edita SUS peritajes.

**Toda query de servidor filtra por `org_id` y rol.** Al tocar `lib/server/*` respeta el gate de autorización existente (ver `inspections.ts`, `orgs.ts`). Solo admin/owner eliminan filas.

### Mensajería WhatsApp (proveedor enchufable)
- Todo pasa por el **dispatcher** `lib/server/messaging.ts`, que elige proveedor según `MESSAGING_PROVIDER`:
  - `"twilio"` → `lib/server/whatsapp-twilio.ts` (webhook en `app/api/webhooks/twilio/`)
  - default → `lib/server/whatsapp-meta.ts` (Meta Cloud API, webhook en `app/api/webhooks/whatsapp/`)
- La lógica de negocio (`lib/server/whatsapp-notifications.ts`) habla **solo** con el dispatcher. Cambiar de proveedor = flippear una env var, no tocar negocio.
- No reintroducir el viejo socket/Baileys (`whatsapp.ts` fue eliminado). Ver `.env.twilio.example`.

### OCR de tarjeta de propiedad
Dos modos (ver `app/api/ocr/ownership-card/route.ts` y `lib/server/vision-ocr.ts`):
- **Visión GPT-4o** (en producción) — modo principal, server-side. Ver `.env.openai.example`.
- **Tesseract en browser** (`tesseract.js`) — fallback; parser columnar + regex en `lib/licenciaTransitoParser.ts`.

### PDF del informe
- Render con **Puppeteer** (`lib/server/pdf-render.ts`) a partir de HTML de `lib/pdf-template.ts`.
- Imágenes se encogen antes de embeber (`lib/server/pdf-image-shrink.ts`).
- Watermark en mosaico (llave + logo); el logo va en capa CSS aparte porque Chromium bloquea raster dentro de background SVG.

## Convenciones y gotchas

- **CSRF:** todo `POST`/mutación desde el cliente a `/api/*` debe ir por el helper `apiFetch` (inyecta el header CSRF). No usar `fetch` crudo para mutaciones.
- **Cámara (`getUserMedia`)** exige secure context: en celulares usa `dev:https`; un cert mkcert sobre IP cruda falla.
- **Copy en español** (Colombia, tuteo neutro — no voseo). Mantener ese registro en UI y mensajes.
- `import "server-only"` encabeza los módulos de `lib/server/`.
- Alias de imports: **`@/`** = raíz del repo.
- No committear: `/.wa-auth/`, `.env*`, `/data/`, assets pesados en `/public/generated/`.

## Tests
- **Vitest**, entorno node, en `tests/`. Cubren: parser de licencia de tránsito, motor de reglas (`rules-engine`), cola de sync, y fixtures de inspección.
- Al cambiar reglas de hallazgos (`lib/findings-catalog.ts`, `lib/rules-engine`) o el parser, actualiza/añade su test.
