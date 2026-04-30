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

async function fetchJson<T>(
  url: string,
  token: string,
  signal: AbortSignal,
): Promise<T> {
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
  return (await res.json()) as T;
}

export function fetchFasecolda(
  plate: string,
  token: string,
  signal: AbortSignal,
): Promise<FasecoldaResponse> {
  const u = `${BASE}/co/fasecolda/values-by-plate?plate=${encodeURIComponent(plate)}`;
  return fetchJson<FasecoldaResponse>(u, token, signal);
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
  return fetchJson<RuntResponse>(u, token, signal);
}
