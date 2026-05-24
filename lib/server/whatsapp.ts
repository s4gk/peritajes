import "server-only";

/**
 * Servicio WhatsApp multi-tenant basado en Baileys (no oficial — emula
 * WhatsApp Web).
 *
 * Cada organización tiene SU PROPIO socket + auth dir. El estado vive en
 * un `Map<orgId, WhatsAppState>` persistido en globalThis para sobrevivir
 * hot-reloads de Next dev. Cada socket es independiente: el cliente del
 * owner A recibe mensajes desde el número del owner A; el ban de Meta a un
 * número afecta solo a esa org.
 *
 * Auth dirs:
 *   .wa-auth/<orgId>/      → creds + app-state-sync-keys de esa org
 *
 * IMPORTANTE: Baileys NO es oficial — Meta puede banear el número si detecta
 * patrones de spam. Por eso metemos delays entre envíos y, ahora con
 * multi-tenant, AISLAMOS el blast radius — un cliente quemado no afecta a
 * los demás.
 */

import fs from "node:fs/promises";
import path from "node:path";

import type pino from "pino";

type Status = "disconnected" | "connecting" | "qr" | "connected";

type QueuedTask = {
  /** Tag corto para logs (p.ej. "client-pdf to 573001234567"). */
  label: string;
  /** Llave de deduplicación. Si dos enqueue() llegan con la misma key dentro
   *  de la ventana DEDUP_TTL_MS, el segundo se descarta. Sirve para evitar
   *  duplicados por reintentos de UI o reconexión del socket. */
  dedupKey: string | null;
  run: () => Promise<void>;
  /** Hook que el caller usa para persistir el resultado del envío. Lo invoca
   *  pumpQueue después de ejecutar `run()` con `ok` o `error`. Para mantener
   *  whatsapp.ts agnóstico de la DB, los errores del callback solo se logean
   *  (no rompen el pump). */
  onResult?: (result: { ok: boolean; error?: string }) => void | Promise<void>;
};

type WhatsAppState = {
  orgId: string;
  status: Status;
  qrText: string | null;
  qrDataUrl: string | null;
  phone: string | null;
  lastError: string | null;
  connectedAt: number | null;
  // Baileys socket — tipo opaco para no atar este archivo a la versión exacta
  // de la librería (los tipos públicos cambian seguido).
  socket: unknown;
  queue: QueuedTask[];
  pumping: boolean;
  reconnectAttempts: number;
  /** Map dedup-key → expiry timestamp (epoch ms). Una vez expira se puede
   *  reusar la key. Se limpia perezosamente en cada enqueue. */
  recentDedup: Map<string, number>;
};

type WhatsAppGlobalState = {
  /** Map<orgId, state>. Una entrada por org que alguna vez se conectó. */
  byOrg: Map<string, WhatsAppState>;
};

const globalScope = globalThis as unknown as {
  __peritoWaMulti?: WhatsAppGlobalState;
  // Legado fase 3 — un solo state global. Lo conservamos por si quedaron
  // referencias colgadas en hot-reload de dev; en prod es ignorado.
  __peritoWa?: unknown;
};

function getGlobalState(): WhatsAppGlobalState {
  if (!globalScope.__peritoWaMulti) {
    globalScope.__peritoWaMulti = { byOrg: new Map() };
  }
  return globalScope.__peritoWaMulti;
}

function getOrCreateState(orgId: string): WhatsAppState {
  const g = getGlobalState();
  let s = g.byOrg.get(orgId);
  if (!s) {
    s = {
      orgId,
      status: "disconnected",
      qrText: null,
      qrDataUrl: null,
      phone: null,
      lastError: null,
      connectedAt: null,
      socket: null,
      queue: [],
      pumping: false,
      reconnectAttempts: 0,
      recentDedup: new Map(),
    };
    g.byOrg.set(orgId, s);
  }
  return s;
}

const AUTH_ROOT = path.resolve(process.cwd(), ".wa-auth");

/**
 * Tenant especial para el admin (Vestel/soporte). Permite que un usuario con
 * `role === "admin"` conecte SU PROPIO número WA — útil para debug, soporte
 * técnico y para procesar peritajes huérfanos sin `org_id` (creados antes de
 * la fase multi-tenant). El admin queda como un "tenant más" desde el punto
 * de vista del singleton: socket aislado, cola propia, auth en
 * `.wa-auth/__admin__/`.
 *
 * El sentinel respeta el regex de `authDirFor` (solo `[A-Za-z0-9_-]`), así
 * que no necesita reglas especiales en path-traversal.
 */
export const ADMIN_WA_ORG = "__admin__";

/**
 * Devuelve el orgId que debe usarse para operaciones WA cuando hay un actor
 * (admin u owner) y opcionalmente un peritaje involucrado. Prioridad:
 *   1. orgId del peritaje (peritajes nuevos tienen org_id de su negocio).
 *   2. orgId del actor (owner/employee operando sobre un peritaje legacy sin
 *      org persistido, pero el actor sí tiene una asignada).
 *   3. Sentinel del admin si el actor es admin (peritaje huérfano + admin).
 *   4. null — no hay socket que usar; el caller decide skip o error.
 */
export function resolveWaOrgId(
  actor: { role: string; orgId: string | null },
  inspectionOrgId?: string | null,
): string | null {
  if (inspectionOrgId) return inspectionOrgId;
  if (actor.orgId) return actor.orgId;
  if (actor.role === "admin") return ADMIN_WA_ORG;
  return null;
}

function authDirFor(orgId: string): string {
  // Sanitizamos el orgId — solo alfanuméricos + guiones. Defense in depth
  // contra path traversal (los IDs salen de createOrganization, que usa
  // base64url, así que esto realmente no debería rechazar nada legítimo).
  if (!/^[A-Za-z0-9_-]+$/.test(orgId)) {
    throw new Error("orgId inválido para auth dir.");
  }
  return path.join(AUTH_ROOT, orgId);
}

// Ventana en la que dos enqueue con la misma dedupKey se colapsan en uno solo.
// 10 minutos cubre el caso típico: el wizard llama dos veces al endpoint de
// finalización (por reintento de red o doble click) y queremos garantizar que
// el cliente no reciba el PDF dos veces. Pasada esa ventana, si vuelve a
// dispararse, asumimos que fue intencional (p.ej. el admin reenvió a mano).
const DEDUP_TTL_MS = 10 * 60_000;

/**
 * Logger silencioso para Baileys — la librería es muy verbosa por defecto y
 * llenaría los logs de pm2 con info irrelevante. Solo dejamos pasar errores
 * fatales.
 */
async function makeSilentLogger(): Promise<pino.Logger> {
  const mod = await import("pino");
  const factory =
    (mod as unknown as { default?: unknown }).default ?? (mod as unknown);
  return (factory as (opts: pino.LoggerOptions) => pino.Logger)({
    level: "silent",
  });
}

/**
 * Conecta (o reconecta) el cliente WA de una org específica. Si ya hay
 * credenciales en `.wa-auth/<orgId>/`, no pide QR; si no, emite uno para
 * que el owner de esa org lo escanee.
 *
 * Es idempotente por org: llamar dos veces no abre dos sockets de la misma.
 */
export async function connectWhatsApp(
  orgId: string,
): Promise<{ status: Status; qrDataUrl: string | null }> {
  const state = getOrCreateState(orgId);
  if (state.status === "connecting" || state.status === "connected") {
    return { status: state.status, qrDataUrl: state.qrDataUrl };
  }
  state.status = "connecting";
  state.lastError = null;

  const authDir = authDirFor(orgId);
  await fs.mkdir(authDir, { recursive: true });

  // Cargamos Baileys via dynamic import — la librería es ESM-only (no se
  // puede `require`) y además es pesada (~5MB), así que solo la traemos
  // cuando alguien usa el feature, no en cada request.
  const baileys = await import("@whiskeysockets/baileys");
  const makeWASocket =
    (baileys as unknown as { default?: typeof baileys.makeWASocket }).default
    ?? baileys.makeWASocket;
  const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = baileys;

  // ESLint piensa que `useMultiFileAuthState` es un React Hook por su prefijo
  // — pero es una función pura de Baileys que carga creds desde disco.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { state: authState, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  const logger = await makeSilentLogger();

  const sock = makeWASocket({
    auth: authState,
    logger,
    browser: Browsers.appropriate(`Perito-${orgId.slice(0, 8)}`),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    ...(version ? { version } : {}),
  });

  state.socket = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      try {
        const qrcodeLib = await import("qrcode");
        state.qrText = qr;
        state.qrDataUrl = await qrcodeLib.toDataURL(qr, { width: 320, margin: 2 });
        state.status = "qr";
      } catch (err) {
        state.lastError = `qr-render: ${(err as Error).message}`;
      }
    }
    if (connection === "open") {
      state.status = "connected";
      state.qrText = null;
      state.qrDataUrl = null;
      state.connectedAt = Date.now();
      state.reconnectAttempts = 0;
      const me = (sock as unknown as { user?: { id?: string } }).user;
      if (me?.id) {
        state.phone = me.id.split("@")[0]?.split(":")[0] ?? null;
      }
      void pumpQueue(orgId);
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
        ?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      state.socket = null;
      if (loggedOut) {
        state.status = "disconnected";
        state.phone = null;
        state.lastError = "logged-out";
        await fs.rm(authDir, { recursive: true, force: true }).catch(() => {});
      } else {
        state.status = "disconnected";
        state.reconnectAttempts += 1;
        if (state.reconnectAttempts <= 5) {
          const delay = Math.min(30_000, 2_000 * 2 ** (state.reconnectAttempts - 1));
          setTimeout(() => {
            void connectWhatsApp(orgId).catch((err) => {
              state.lastError = (err as Error).message;
            });
          }, delay);
        } else {
          state.lastError = "max-reconnect-attempts";
        }
      }
    }
  });

  return { status: state.status, qrDataUrl: state.qrDataUrl };
}

/**
 * Manda un texto de prueba al PROPIO número conectado en la org. Sirve como
 * smoke test on-demand desde el panel `/whatsapp` — el dueño aprieta "enviar
 * mensaje de prueba" después de escanear el QR y debe ver el texto llegar a
 * su WhatsApp en segundos. Si no llega, la vinculación quedó incompleta.
 *
 * Decisión: NO lo hacemos automáticamente en `connection === "open"`. Probamos
 * eso y un envío self-to-self justo después del pairing en Baileys 7.0.0-rc11
 * dejó la sesión Signal en estado raro ("Bad MAC", "closed session") y forzó
 * reconexiones interminables. Manualizándolo evitamos el race con el sync
 * post-pairing.
 */
export function sendSelfTestMessage(orgId: string): {
  accepted: boolean;
  reason?: string;
  phone: string | null;
} {
  const state = getOrCreateState(orgId);
  if (state.status !== "connected" || !state.phone) {
    return {
      accepted: false,
      reason: "WhatsApp no está conectado",
      phone: state.phone,
    };
  }
  const text = [
    "✅ *Prueba de Perito*",
    "",
    "Si recibes este mensaje, tu WhatsApp está conectado correctamente.",
    "Los envíos automáticos al cliente (link de firma, PDF, recordatorios) van a funcionar.",
  ].join("\n");
  const r = sendText(orgId, state.phone, text, {
    // No dedupKey → permitimos múltiples pruebas; el botón es manual.
    label: `test-self to ${state.phone}`,
  });
  return { ...r, phone: state.phone };
}

export async function logoutWhatsApp(orgId: string): Promise<void> {
  const state = getOrCreateState(orgId);
  const sock = state.socket as
    | { logout?: () => Promise<void>; end?: (err?: Error) => void }
    | null;
  if (sock?.logout) {
    await sock.logout().catch(() => {});
  } else if (sock?.end) {
    sock.end(undefined);
  }
  state.socket = null;
  state.status = "disconnected";
  state.qrText = null;
  state.qrDataUrl = null;
  state.phone = null;
  state.connectedAt = null;
  state.reconnectAttempts = 0;
  await fs.rm(authDirFor(orgId), { recursive: true, force: true }).catch(() => {});
}

export function getWhatsAppStatus(orgId: string) {
  const state = getOrCreateState(orgId);
  return {
    status: state.status,
    phone: state.phone,
    qrDataUrl: state.qrDataUrl,
    connectedAt: state.connectedAt,
    lastError: state.lastError,
    queueSize: state.queue.length,
  };
}

/**
 * Normaliza un teléfono a JID de WhatsApp.
 *
 * Solo acepta celulares colombianos válidos: 10 dígitos empezando en 3
 * (`3XXXXXXXXX`), opcionalmente con prefijo `+57`/`57`. Si la entrada no
 * encaja, lanzamos un error claro — preferible a que Baileys haga el send a
 * un JID inválido y nuestro audit registre `sent: true` sin que el mensaje
 * jamás llegue (lo vimos pasar con `+57313880739`, 9 dígitos locales).
 */
function jidFor(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) throw new Error("Teléfono vacío");
  let withCc: string;
  if (digits.length === 10 && digits.startsWith("3")) {
    withCc = `57${digits}`;
  } else if (digits.length === 12 && digits.startsWith("573")) {
    withCc = digits;
  } else {
    throw new Error(
      `Teléfono inválido "${phone}": se espera celular colombiano de 10 dígitos empezando en 3 (con o sin prefijo +57).`,
    );
  }
  return `${withCc}@s.whatsapp.net`;
}

/**
 * Bombea la cola de UNA org con delay aleatorio entre 2 y 5 segundos por
 * mensaje. Los delays son la principal defensa contra el detector
 * anti-spam de Meta. Si no hay socket conectado para esta org, los
 * mensajes quedan en cola hasta que `connection === "open"` y se reinicia
 * el pump.
 */
async function pumpQueue(orgId: string): Promise<void> {
  const state = getOrCreateState(orgId);
  if (state.pumping) return;
  state.pumping = true;
  try {
    while (state.queue.length > 0 && state.status === "connected") {
      const task = state.queue.shift();
      if (!task) break;
      let runError: string | undefined;
      try {
        await task.run();
      } catch (err) {
        runError = (err as Error).message;
        console.error(
          `[wa:${orgId}] envío "${task.label}" falló:`,
          runError,
        );
      }
      if (task.onResult) {
        try {
          await task.onResult(
            runError ? { ok: false, error: runError } : { ok: true },
          );
        } catch (err) {
          console.error(
            `[wa:${orgId}] onResult de "${task.label}" tronó:`,
            (err as Error).message,
          );
        }
      }
      const delay = 2_000 + Math.floor(Math.random() * 3_000);
      await new Promise((r) => setTimeout(r, delay));
    }
  } finally {
    state.pumping = false;
  }
}

function ensureReady(orgId: string): { socket: WaSocket } {
  const state = getOrCreateState(orgId);
  if (state.status !== "connected" || !state.socket) {
    throw new Error(`WhatsApp no está conectado para org ${orgId}`);
  }
  return { socket: state.socket as WaSocket };
}

type WaSocket = {
  sendMessage: (
    jid: string,
    content: Record<string, unknown>,
  ) => Promise<unknown>;
};

/**
 * Encola un envío en la cola de la org dada. La función se ejecuta cuando le
 * toca el turno respetando el delay anti-spam. Si WA no está conectado,
 * encolamos igual y se procesará cuando reconecte.
 *
 * `dedupKey` (opcional): si dentro de DEDUP_TTL_MS llega otro enqueue con
 * la misma key (en esta org), se descarta. La dedup es POR ORG — el mismo
 * key en orgs distintas son envíos independientes.
 */
export type EnqueueResultHook = (result: {
  ok: boolean;
  error?: string;
}) => void | Promise<void>;

function enqueue(
  orgId: string,
  run: () => Promise<void>,
  opts: { label: string; dedupKey?: string; onResult?: EnqueueResultHook },
): { accepted: boolean; reason?: string } {
  const state = getOrCreateState(orgId);
  const now = Date.now();

  if (state.recentDedup.size > 0) {
    for (const [k, exp] of state.recentDedup) {
      if (exp <= now) state.recentDedup.delete(k);
    }
  }

  if (opts.dedupKey) {
    const exp = state.recentDedup.get(opts.dedupKey);
    if (exp && exp > now) {
      console.warn(
        `[wa:${orgId}] descartado por dedup: ${opts.label} (key=${opts.dedupKey})`,
      );
      return { accepted: false, reason: "dedup" };
    }
    state.recentDedup.set(opts.dedupKey, now + DEDUP_TTL_MS);
  }

  state.queue.push({
    label: opts.label,
    dedupKey: opts.dedupKey ?? null,
    run,
    onResult: opts.onResult,
  });
  void pumpQueue(orgId);
  return { accepted: true };
}

export function sendText(
  orgId: string,
  phone: string,
  text: string,
  opts: { dedupKey?: string; label?: string; onResult?: EnqueueResultHook } = {},
): { accepted: boolean; reason?: string } {
  const jid = jidFor(phone);
  return enqueue(
    orgId,
    async () => {
      const { socket } = ensureReady(orgId);
      await socket.sendMessage(jid, { text });
    },
    {
      label: opts.label ?? `text to ${phone}`,
      dedupKey: opts.dedupKey,
      onResult: opts.onResult,
    },
  );
}

export function sendDocument(
  orgId: string,
  phone: string,
  buffer: Buffer,
  filename: string,
  options: {
    caption?: string;
    mimetype?: string;
    dedupKey?: string;
    label?: string;
    onResult?: EnqueueResultHook;
  } = {},
): { accepted: boolean; reason?: string } {
  const jid = jidFor(phone);
  const mimetype = options.mimetype ?? "application/pdf";
  return enqueue(
    orgId,
    async () => {
      const { socket } = ensureReady(orgId);
      await socket.sendMessage(jid, {
        document: buffer,
        fileName: filename,
        mimetype,
        caption: options.caption,
      });
    },
    {
      label: options.label ?? `doc ${filename} to ${phone}`,
      dedupKey: options.dedupKey,
      onResult: options.onResult,
    },
  );
}

/**
 * Auto-conecta TODAS las orgs que tengan credenciales en disco. Recorre
 * `.wa-auth/*` y por cada subdir con `creds.json` lanza una reconexión.
 * Útil para que tras un reinicio de pm2 todos los sockets vuelvan online
 * sin que ningún owner tenga que entrar a su panel.
 */
export async function autoConnectIfPersisted(): Promise<void> {
  // Aprovechamos esta llamada (hit del panel /whatsapp, fire-and-forget) para
  // arrancar también el loop de recordatorios de cita. Es idempotente, así
  // que llamarlo en cada hit del status endpoint no duplica timers.
  void import("./whatsapp-reminders")
    .then((m) => m.startReminderLoop())
    .catch((err) =>
      console.error("[wa] no se pudo arrancar reminder loop:", (err as Error).message),
    );

  let entries: string[];
  try {
    entries = await fs.readdir(AUTH_ROOT);
  } catch {
    return; // no hay carpeta — install nueva o nadie conectó nunca.
  }

  for (const entry of entries) {
    const orgId = entry;
    if (!/^[A-Za-z0-9_-]+$/.test(orgId)) continue;
    try {
      await fs.access(path.join(AUTH_ROOT, orgId, "creds.json"));
    } catch {
      continue; // sin creds → nada que reconectar.
    }
    const state = getOrCreateState(orgId);
    if (state.status !== "disconnected") continue;
    await connectWhatsApp(orgId).catch((err) => {
      state.lastError = (err as Error).message;
    });
  }
}
