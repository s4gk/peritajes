import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Tests del wrapper de envíos WhatsApp — exclusivamente la lógica de
 * deduplicación dentro de enqueue. No tocamos Baileys (la librería se carga
 * dynamicamente solo dentro de connectWhatsApp, que estos tests nunca llaman).
 *
 * El estado del módulo vive en globalThis como Map<orgId, state>, así que
 * reseteamos entre tests.
 *
 * Nota: `server-only` lo resuelve Next.js con un loader especial — en Node
 * puro (vitest) no está instalado y rompe el import. Lo stubeamos como
 * módulo vacío para que la carga pase.
 */
vi.mock("server-only", () => ({}));

type WaGlobal = { __peritoWaMulti?: unknown };

function resetWaState() {
  delete (globalThis as unknown as WaGlobal).__peritoWaMulti;
}

const ORG = "org_test123";

const { sendText, getWhatsAppStatus } = await import("@/lib/server/whatsapp");

beforeEach(resetWaState);

describe("whatsapp · dedup en enqueue (multi-tenant)", () => {
  test("una segunda llamada con la misma dedupKey se descarta", () => {
    const r1 = sendText(ORG, "3001234567", "hola", { dedupKey: "evt:1" });
    const r2 = sendText(ORG, "3001234567", "hola", { dedupKey: "evt:1" });

    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(false);
    expect(r2.reason).toBe("dedup");

    expect(getWhatsAppStatus(ORG).queueSize).toBe(1);
  });

  test("dedupKeys distintas siempre se aceptan", () => {
    const r1 = sendText(ORG, "3001234567", "a", { dedupKey: "evt:1" });
    const r2 = sendText(ORG, "3001234567", "b", { dedupKey: "evt:2" });

    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(true);
    expect(getWhatsAppStatus(ORG).queueSize).toBe(2);
  });

  test("sin dedupKey, llamadas idénticas siempre se aceptan (no hay magia)", () => {
    const r1 = sendText(ORG, "3001234567", "hola");
    const r2 = sendText(ORG, "3001234567", "hola");

    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(true);
    expect(getWhatsAppStatus(ORG).queueSize).toBe(2);
  });

  test("misma dedupKey en distintas orgs no se descarta — son sockets independientes", () => {
    const r1 = sendText("org_a", "3001234567", "hola", { dedupKey: "evt:1" });
    const r2 = sendText("org_b", "3001234567", "hola", { dedupKey: "evt:1" });

    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(true);
    // Cada org tiene su cola independiente.
    expect(getWhatsAppStatus("org_a").queueSize).toBe(1);
    expect(getWhatsAppStatus("org_b").queueSize).toBe(1);
  });

  test("una dedupKey vencida vuelve a aceptar el siguiente envío", () => {
    sendText(ORG, "3001234567", "hola", { dedupKey: "evt:1" });

    // Simulamos el paso del tiempo manipulando el TTL en el mapa de la org.
    const state = (
      globalThis as unknown as {
        __peritoWaMulti: { byOrg: Map<string, { recentDedup: Map<string, number> }> };
      }
    ).__peritoWaMulti.byOrg.get(ORG)!;
    state.recentDedup.set("evt:1", Date.now() - 1000);

    const r2 = sendText(ORG, "3001234567", "hola", { dedupKey: "evt:1" });
    expect(r2.accepted).toBe(true);
    expect(getWhatsAppStatus(ORG).queueSize).toBe(2);
  });

  test("el label se preserva en el task para diagnóstico en logs", () => {
    sendText(ORG, "3001234567", "hola", {
      dedupKey: "evt:42",
      label: "client-pdf to 3001234567",
    });

    const state = (
      globalThis as unknown as {
        __peritoWaMulti: {
          byOrg: Map<
            string,
            { queue: Array<{ label: string; dedupKey: string | null }> }
          >;
        };
      }
    ).__peritoWaMulti.byOrg.get(ORG)!;

    expect(state.queue[0].label).toBe("client-pdf to 3001234567");
    expect(state.queue[0].dedupKey).toBe("evt:42");
  });
});

describe("whatsapp · normalización de teléfono", () => {
  test("un número 10 dígitos que arranca en 3 se completa con CO (+57)", () => {
    expect(() => sendText(ORG, "3105551234", "hi")).not.toThrow();
    expect(getWhatsAppStatus(ORG).queueSize).toBe(1);
  });

  test("un teléfono vacío lanza", () => {
    expect(() => sendText(ORG, "", "hi")).toThrow(/vacío/i);
  });

  test("un teléfono demasiado corto lanza", () => {
    expect(() => sendText(ORG, "12345", "hi")).toThrow(/corto/i);
  });
});
