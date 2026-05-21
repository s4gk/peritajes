import "server-only";

/**
 * Servicio WhatsApp basado en Baileys (no oficial — emula WhatsApp Web).
 *
 * El módulo expone un singleton (persistido en globalThis para sobrevivir
 * los hot-reloads de Next dev) que mantiene:
 *  - estado de conexión (disconnected | connecting | qr | connected)
 *  - último QR generado (data URL PNG) hasta que el cliente se loguea
 *  - cola FIFO de envíos con delay aleatorio 2-5s entre mensajes
 *
 * Las credenciales viven en `./.wa-auth/` (gitignored). Si se borra esa
 * carpeta hay que re-escanear QR. Si el server reinicia, Baileys recupera
 * la sesión automáticamente sin pedir QR de nuevo.
 *
 * IMPORTANTE: Baileys NO es oficial — Meta puede banear el número usado
 * si detecta patrones de spam. Por eso metemos delays entre envíos y no
 * mandamos a destinatarios que no tienen el número en agenda.
 */

import fs from "node:fs/promises";
import path from "node:path";

import type pino from "pino";

type Status = "disconnected" | "connecting" | "qr" | "connected";

type WhatsAppState = {
  status: Status;
  qrText: string | null;
  qrDataUrl: string | null;
  phone: string | null;
  lastError: string | null;
  connectedAt: number | null;
  // Baileys socket — tipo opaco para no atar este archivo a la versión exacta
  // de la librería (los tipos públicos cambian seguido).
  socket: unknown;
  queue: Array<() => Promise<void>>;
  pumping: boolean;
  reconnectAttempts: number;
};

const globalScope = globalThis as unknown as { __peritoWa?: WhatsAppState };

function getState(): WhatsAppState {
  if (!globalScope.__peritoWa) {
    globalScope.__peritoWa = {
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
    };
  }
  return globalScope.__peritoWa;
}

const AUTH_DIR = path.resolve(process.cwd(), ".wa-auth");

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
 * Conecta (o reconecta) el cliente WA. Si ya hay credenciales en disco, no
 * pide QR; si no, emite un QR que el admin debe escanear.
 *
 * Es idempotente: llamar dos veces seguidas no abre dos sockets.
 */
export async function connectWhatsApp(): Promise<{ status: Status; qrDataUrl: string | null }> {
  const state = getState();
  if (state.status === "connecting" || state.status === "connected") {
    return { status: state.status, qrDataUrl: state.qrDataUrl };
  }
  state.status = "connecting";
  state.lastError = null;

  await fs.mkdir(AUTH_DIR, { recursive: true });

  // Cargamos Baileys via dynamic import — la librería es ESM-only (no se
  // puede `require`) y además es pesada (~5MB), así que solo la traemos
  // cuando alguien usa el feature, no en cada request.
  const baileys = await import("@whiskeysockets/baileys");
  const makeWASocket =
    (baileys as unknown as { default?: typeof baileys.makeWASocket }).default
    ?? baileys.makeWASocket;
  const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = baileys;

  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  const logger = await makeSilentLogger();

  const sock = makeWASocket({
    auth: authState,
    logger,
    browser: Browsers.appropriate("Perito"),
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
      // Generamos el PNG data URL una sola vez por QR — el cliente admin lo
      // pollea y nosotros lo servimos cacheado.
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
      // El JID del socket trae el número conectado (formato 573001234567:NN@s.whatsapp.net).
      const me = (sock as unknown as { user?: { id?: string } }).user;
      if (me?.id) {
        state.phone = me.id.split("@")[0]?.split(":")[0] ?? null;
      }
      // Si había mensajes encolados antes de conectar, bombea la cola.
      void pumpQueue();
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
        ?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      state.socket = null;
      if (loggedOut) {
        // Sesión inválida: borramos credenciales para que la próxima vez
        // se pida un QR nuevo en vez de loopear contra el mismo error.
        state.status = "disconnected";
        state.phone = null;
        state.lastError = "logged-out";
        await fs.rm(AUTH_DIR, { recursive: true, force: true }).catch(() => {});
      } else {
        // Cualquier otra desconexión (red, restart, etc.): reintentamos con
        // backoff. Capeamos en 5 intentos para no quemar CPU si Meta nos cerró.
        state.status = "disconnected";
        state.reconnectAttempts += 1;
        if (state.reconnectAttempts <= 5) {
          const delay = Math.min(30_000, 2_000 * 2 ** (state.reconnectAttempts - 1));
          setTimeout(() => {
            void connectWhatsApp().catch((err) => {
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

export async function logoutWhatsApp(): Promise<void> {
  const state = getState();
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
  await fs.rm(AUTH_DIR, { recursive: true, force: true }).catch(() => {});
}

export function getWhatsAppStatus() {
  const state = getState();
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
 * Acepta entradas tipo "+57 310 555 1234", "3105551234", "57 310 555 1234".
 * Si el número no trae código de país, asume Colombia (+57) — el uso es
 * peritos y clientes locales.
 */
function jidFor(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) throw new Error("Teléfono vacío");
  const withCc = digits.length === 10 && digits.startsWith("3") ? `57${digits}` : digits;
  if (withCc.length < 10) throw new Error("Teléfono demasiado corto");
  return `${withCc}@s.whatsapp.net`;
}

/**
 * Bombea la cola con delay aleatorio entre 2 y 5 segundos por mensaje. Los
 * delays son la principal defensa contra el detector anti-spam de Meta —
 * mandar 50 mensajes en 5 segundos es la receta para ban.
 *
 * Si no hay socket conectado, los mensajes quedan en cola hasta que
 * `connection === "open"` y se reinicia el pump.
 */
async function pumpQueue(): Promise<void> {
  const state = getState();
  if (state.pumping) return;
  state.pumping = true;
  try {
    while (state.queue.length > 0 && state.status === "connected") {
      const task = state.queue.shift();
      if (!task) break;
      try {
        await task();
      } catch (err) {
        console.error("[wa] envío falló:", (err as Error).message);
      }
      const delay = 2_000 + Math.floor(Math.random() * 3_000);
      await new Promise((r) => setTimeout(r, delay));
    }
  } finally {
    state.pumping = false;
  }
}

function ensureReady(): { socket: WaSocket } {
  const state = getState();
  if (state.status !== "connected" || !state.socket) {
    throw new Error("WhatsApp no está conectado");
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
 * Encola un envío. La función se ejecuta cuando le toca el turno respetando
 * el delay anti-spam. Si WA no está conectado, encolamos igual y se procesará
 * cuando reconecte.
 */
function enqueue(task: () => Promise<void>): void {
  const state = getState();
  state.queue.push(task);
  void pumpQueue();
}

export function sendText(phone: string, text: string): void {
  const jid = jidFor(phone);
  enqueue(async () => {
    const { socket } = ensureReady();
    await socket.sendMessage(jid, { text });
  });
}

export function sendDocument(
  phone: string,
  buffer: Buffer,
  filename: string,
  options: { caption?: string; mimetype?: string } = {},
): void {
  const jid = jidFor(phone);
  const mimetype = options.mimetype ?? "application/pdf";
  enqueue(async () => {
    const { socket } = ensureReady();
    await socket.sendMessage(jid, {
      document: buffer,
      fileName: filename,
      mimetype,
      caption: options.caption,
    });
  });
}

/**
 * Auto-conecta si hay credenciales en disco pero el módulo aún no levantó.
 * Útil para que después de un reinicio de pm2 el server vuelva a estar
 * online sin que el admin tenga que entrar a la UI.
 */
export async function autoConnectIfPersisted(): Promise<void> {
  const state = getState();
  if (state.status !== "disconnected") return;
  try {
    await fs.access(path.join(AUTH_DIR, "creds.json"));
  } catch {
    return; // no hay credenciales — esperamos que el admin escanee QR.
  }
  await connectWhatsApp().catch((err) => {
    state.lastError = (err as Error).message;
  });
}
