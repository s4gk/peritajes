import type { z } from "zod";

import { FasecoldaResponseSchema, RuntResponseSchema } from "./schema";
import type { FasecoldaResponse, RuntResponse } from "./types";

const BASE = "https://api.verifik.co/v2";

export class VerifikError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "VerifikError";
  }
}

export type RuntLookupParams = {
  documentType: string;
  documentNumber: string;
  plate: string;
};

/**
 * Hace fetch + parse + valida contra el schema Zod. Si el shape no matchea,
 * tira VerifikError 502 con detalle resumido — el caller decide cómo
 * mostrarlo al perito (toast + auto-completar a mano vs. retry).
 */
async function fetchValidated<S extends z.ZodTypeAny>(
  url: string,
  token: string,
  signal: AbortSignal,
  schema: S,
): Promise<z.infer<S>> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new VerifikError(res.status, `${res.status} ${body.slice(0, 200)}`);
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new VerifikError(502, "Respuesta no es JSON válido");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Loggeamos el detalle a stderr para debugging — el cliente sólo recibe
    // el resumen para no exponer estructura interna.
    console.error(
      "[verifik] response shape mismatch:",
      parsed.error.issues.slice(0, 5),
    );
    throw new VerifikError(
      502,
      `Respuesta de Verifik con formato inesperado (${parsed.error.issues.length} issues)`,
    );
  }
  return parsed.data;
}

export function fetchFasecolda(
  plate: string,
  token: string,
  signal: AbortSignal,
): Promise<FasecoldaResponse> {
  const u = `${BASE}/co/fasecolda/values-by-plate?plate=${encodeURIComponent(plate)}`;
  return fetchValidated(u, token, signal, FasecoldaResponseSchema) as Promise<FasecoldaResponse>;
}

export function fetchRunt(
  p: RuntLookupParams,
  token: string,
  signal: AbortSignal,
): Promise<RuntResponse> {
  const qs = new URLSearchParams({
    documentType: p.documentType,
    documentNumber: p.documentNumber,
    plate: p.plate,
  }).toString();
  const u = `${BASE}/co/runt/vehicle-by-plate?${qs}`;
  return fetchValidated(u, token, signal, RuntResponseSchema) as Promise<RuntResponse>;
}
