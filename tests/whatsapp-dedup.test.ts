import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Tests del wrapper de envíos WhatsApp — exclusivamente la lógica de
 * deduplicación dentro de enqueue. No tocamos Baileys (la librería se carga
 * dynamicamente solo dentro de connectWhatsApp, que estos tests nunca llaman).
 *
 * El estado del módulo vive en globalThis, así que reseteamos entre tests.
 *
 * Nota: `server-only` lo resuelve Next.js con un loader especial — en Node
 * puro (vitest) no está instalado y rompe el import. Lo stubeamos como
 * módulo vacío para que la carga pase.
 */
vi.mock("server-only", () => ({}));

type WaGlobal = { __peritoWa?: unknown };

function resetWaState() {
  delete (globalThis as unknown as WaGlobal).__peritoWa;
}

// Importamos una vez; los re-imports posteriores van al cache (el módulo no
// se vuelve a ejecutar, pero la referencia a globalThis se re-resuelve en
// cada call a getState()).
const { sendText, getWhatsAppStatus } = await import("@/lib/server/whatsapp");

beforeEach(resetWaState);

describe("whatsapp · dedup en enqueue", () => {
  test("una segunda llamada con la misma dedupKey se descarta", () => {
    const r1 = sendText("3001234567", "hola", { dedupKey: "evt:1" });
    const r2 = sendText("3001234567", "hola", { dedupKey: "evt:1" });

    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(false);
    expect(r2.reason).toBe("dedup");

    // Solo quedó el primer task en la cola — el segundo nunca se encoló.
    expect(getWhatsAppStatus().queueSize).toBe(1);
  });

  test("dedupKeys distintas siempre se aceptan", () => {
    const r1 = sendText("3001234567", "a", { dedupKey: "evt:1" });
    const r2 = sendText("3001234567", "b", { dedupKey: "evt:2" });

    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(true);
    expect(getWhatsAppStatus().queueSize).toBe(2);
  });

  test("sin dedupKey, llamadas idénticas siempre se aceptan (no hay magia)", () => {
    // La dedup es opt-in: si el caller no provee key, asumimos que sabe lo
    // que hace (p.ej. enviar dos avisos a propósito en distintos turnos).
    const r1 = sendText("3001234567", "hola");
    const r2 = sendText("3001234567", "hola");

    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(true);
    expect(getWhatsAppStatus().queueSize).toBe(2);
  });

  test("una dedupKey vencida vuelve a aceptar el siguiente envío", () => {
    sendText("3001234567", "hola", { dedupKey: "evt:1" });

    // Simulamos el paso del tiempo manipulando el TTL en el mapa directamente.
    // Es la forma más limpia de testear la expiración sin esperar 10 minutos
    // ni mockear Date.now globalmente.
    const state = (globalThis as unknown as { __peritoWa: { recentDedup: Map<string, number> } })
      .__peritoWa;
    state.recentDedup.set("evt:1", Date.now() - 1000);

    const r2 = sendText("3001234567", "hola", { dedupKey: "evt:1" });
    expect(r2.accepted).toBe(true);
    expect(getWhatsAppStatus().queueSize).toBe(2);
  });

  test("el label se preserva en el task para diagnóstico en logs", () => {
    sendText("3001234567", "hola", {
      dedupKey: "evt:42",
      label: "client-pdf to 3001234567",
    });

    const state = (globalThis as unknown as {
      __peritoWa: { queue: Array<{ label: string; dedupKey: string | null }> };
    }).__peritoWa;

    expect(state.queue[0].label).toBe("client-pdf to 3001234567");
    expect(state.queue[0].dedupKey).toBe("evt:42");
  });
});

describe("whatsapp · normalización de teléfono", () => {
  test("un número 10 dígitos que arranca en 3 se completa con CO (+57)", () => {
    // No podemos espiar jidFor (es interno), pero validamos indirectamente:
    // el send no tira y la cola crece a 1.
    expect(() => sendText("3105551234", "hi")).not.toThrow();
    expect(getWhatsAppStatus().queueSize).toBe(1);
  });

  test("un teléfono vacío lanza", () => {
    expect(() => sendText("", "hi")).toThrow(/vacío/i);
  });

  test("un teléfono demasiado corto lanza", () => {
    expect(() => sendText("12345", "hi")).toThrow(/corto/i);
  });
});
