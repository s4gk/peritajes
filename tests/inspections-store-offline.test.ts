import { describe, expect, test } from "vitest";

import { isQuotaError, pickDraftsToPrefetch, pickSyncWinner } from "@/lib/inspections-store";
import type { StoredInspection } from "@/lib/types";

function row(
  id: string,
  opts: Partial<StoredInspection> & { status?: "draft" | "completed" } = {},
): StoredInspection {
  const { status = "draft", ...rest } = opts;
  return {
    id,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    userId: "u1",
    partial: true,
    data: { status } as StoredInspection["data"],
    ...rest,
  };
}

describe("pickDraftsToPrefetch", () => {
  test("solo borradores livianos del usuario, los más recientes primero", () => {
    const list = [
      row("viejo", { updatedAt: "2026-09-01T00:00:00Z" }),
      row("nuevo", { updatedAt: "2026-09-20T00:00:00Z" }),
      row("ajeno", { userId: "u2" }),
      row("finalizado", { status: "completed" }),
      row("bloqueado", { lockedAt: "2026-09-02T00:00:00Z" }),
      row("ya-completo", { partial: undefined }),
    ];
    const now = new Date("2026-09-23T00:00:00Z").getTime();
    expect(pickDraftsToPrefetch(list, "u1", 8, now).map((r) => r.id)).toEqual(["nuevo", "viejo"]);
  });

  test("respeta el máximo", () => {
    const list = Array.from({ length: 30 }, (_, i) =>
      row(`d${i}`, { updatedAt: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00Z` }),
    );
    const now = new Date("2026-09-23T00:00:00Z").getTime();
    expect(pickDraftsToPrefetch(list, "u1", 5, now)).toHaveLength(5);
  });

  test("no baja borradores de hace más de 30 días", () => {
    const now = new Date("2026-09-23T00:00:00Z").getTime();
    const list = [row("reciente", { updatedAt: "2026-09-10T00:00:00Z" }), row("abandonado", { updatedAt: "2026-06-01T00:00:00Z" })];
    expect(pickDraftsToPrefetch(list, "u1", 8, now).map((r) => r.id)).toEqual(["reciente"]);
  });
});

describe("isQuotaError", () => {
  test("reconoce QuotaExceededError directo, envuelto o por mensaje", () => {
    expect(isQuotaError({ name: "QuotaExceededError" })).toBe(true);
    expect(isQuotaError({ name: "AbortError", inner: { name: "QuotaExceededError" } })).toBe(true);
    expect(isQuotaError(new Error("The quota has been exceeded."))).toBe(true);
    expect(isQuotaError(new Error("network"))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});

describe("pickSyncWinner (regla de conflictos)", () => {
  const local = row("x", { updatedAt: "2026-09-10T00:00:00Z", partial: undefined });
  const newerServer = row("x", { updatedAt: "2026-09-20T00:00:00Z" });
  const olderServer = row("x", { updatedAt: "2026-09-01T00:00:00Z" });

  test("con cambios pendientes en el celular gana la copia local aunque el server sea más nuevo", () => {
    expect(pickSyncWinner(local, newerServer, true)).toBe(local);
  });
  test("sin pendientes gana el server si es más nuevo", () => {
    expect(pickSyncWinner(local, newerServer, false)).toBe(newerServer);
  });
  test("sin pendientes y local al día: se queda la local (conserva fotos)", () => {
    expect(pickSyncWinner(local, olderServer, false)).toBe(local);
  });
  test("si no hay copia local, la del server", () => {
    expect(pickSyncWinner(undefined, newerServer, false)).toBe(newerServer);
  });
});
