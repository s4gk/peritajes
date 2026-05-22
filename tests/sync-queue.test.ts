import { beforeEach, describe, expect, test, vi } from "vitest";

import type { PendingMutation } from "@/lib/client/idb";

/**
 * Tests del estado de la cola de sincronización.
 *
 * sync-queue importa idb y api-client; los mockeamos a nivel de módulo para
 * no tocar IndexedDB ni la red. El estado interno del sync-queue es
 * module-level, así que cada test resetea el "almacén" mock antes de correr.
 */

type MockApiResponse = { status: number; body?: unknown };

const fakeQueue: Map<number, PendingMutation> = new Map();
let nextId = 1;
const apiResponses: MockApiResponse[] = [];

vi.mock("@/lib/client/idb", () => ({
  idbListMutations: vi.fn(async () => Array.from(fakeQueue.values())),
  idbCountMutations: vi.fn(async () => fakeQueue.size),
  idbRemoveMutation: vi.fn(async (id: number) => {
    fakeQueue.delete(id);
  }),
  idbUpdateMutation: vi.fn(async (m: PendingMutation) => {
    if (m.id !== undefined) fakeQueue.set(m.id, m);
  }),
}));

vi.mock("@/lib/client/api-client", () => ({
  apiFetch: vi.fn(async () => {
    const r = apiResponses.shift() ?? { status: 200, body: { ok: true } };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: "TEST",
      json: async () => r.body ?? {},
    };
  }),
}));

// Importamos DESPUÉS de declarar los mocks — vi.mock se hoistea por encima,
// así sync-queue carga las versiones mockeadas de sus deps.
const {
  flushSyncQueue,
  refreshPending,
  subscribeSync,
  getSyncState,
} = await import("@/lib/client/sync-queue");

function seed(
  partial: Omit<PendingMutation, "id" | "enqueuedAt" | "attempts"> &
    Partial<Pick<PendingMutation, "attempts" | "lastError" | "lastAttemptAt">>,
): PendingMutation {
  const id = nextId++;
  const m: PendingMutation = {
    id,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
    ...partial,
  };
  fakeQueue.set(id, m);
  return m;
}

beforeEach(() => {
  fakeQueue.clear();
  nextId = 1;
  apiResponses.length = 0;
});

describe("sync-queue · flushSyncQueue", () => {
  test("una mutation update exitosa se borra de la cola", async () => {
    seed({ kind: "update", inspectionId: "abc", data: { vehicle: {} } as never });
    apiResponses.push({
      status: 200,
      body: { inspection: { id: "abc", data: {} } },
    });

    await flushSyncQueue();

    expect(fakeQueue.size).toBe(0);
  });

  test("un 423 Locked también drena la mutation (server gana)", async () => {
    // El cliente piensa que sigue editando un borrador pero el server ya lo
    // cerró. La mutation se descarta — reintentar no tiene sentido — y se
    // aplica la versión canónica del server al cache.
    seed({ kind: "update", inspectionId: "abc", data: {} as never });
    apiResponses.push({
      status: 423,
      body: { inspection: { id: "abc", data: {} } },
    });

    await flushSyncQueue();

    expect(fakeQueue.size).toBe(0);
  });

  test("una mutation que falla incrementa attempts y guarda lastError", async () => {
    seed({ kind: "update", inspectionId: "abc", data: {} as never });
    apiResponses.push({ status: 500 });

    await flushSyncQueue();

    const list = Array.from(fakeQueue.values());
    expect(list).toHaveLength(1);
    expect(list[0].attempts).toBe(1);
    expect(list[0].lastError).toMatch(/500/);
    expect(list[0].lastAttemptAt).toBeTruthy();
  });

  test("flushSyncQueue corta en el primer fallo y deja el resto en cola", async () => {
    // Garantía importante: si una mutation falla no seguimos quemando
    // requests con las siguientes (suelen estar relacionadas y van a fallar
    // por la misma razón). Esperamos al próximo tick.
    seed({ kind: "update", inspectionId: "a", data: {} as never });
    seed({ kind: "update", inspectionId: "b", data: {} as never });
    apiResponses.push({ status: 500 });

    await flushSyncQueue();

    expect(fakeQueue.size).toBe(2);
    expect(fakeQueue.get(1)?.attempts).toBe(1);
    expect(fakeQueue.get(2)?.attempts).toBe(0);
  });

  test("mutations con attempts >= MAX_ATTEMPTS y último intento reciente se saltean", async () => {
    // Si una mutation ya falló 12+ veces y la última corrida fue hace menos
    // de 5 min, no la reintentamos en este flush — esperamos al próximo
    // tick de FAILED_RETRY_INTERVAL_MS.
    seed({
      kind: "update",
      inspectionId: "stuck",
      data: {} as never,
      attempts: 12,
      lastError: "boom",
      lastAttemptAt: new Date().toISOString(),
    });

    await flushSyncQueue();

    // Sigue en cola — nadie la procesó.
    expect(fakeQueue.size).toBe(1);
    // No se consumió ninguna respuesta — el flush ni intentó hablar con el server.
    expect(apiResponses).toHaveLength(0);
  });
});

describe("sync-queue · refreshPending / SyncState", () => {
  test("refreshPending reporta cantidad, failed y lastErrorMessage", async () => {
    seed({ kind: "update", inspectionId: "fresh", data: {} as never });
    seed({
      kind: "update",
      inspectionId: "stuck",
      data: {} as never,
      attempts: 12,
      lastError: "DB caída",
    });

    await refreshPending();

    const s = getSyncState();
    expect(s.pending).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.lastErrorMessage).toBe("DB caída");
    expect(s.oldestPendingAt).toBeTruthy();
  });

  test("subscribeSync invoca al listener con el estado actual y permite unsub", async () => {
    const fn = vi.fn();
    const unsub = subscribeSync(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    await refreshPending();
    expect(fn).toHaveBeenCalledTimes(2);

    unsub();
    await refreshPending();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
