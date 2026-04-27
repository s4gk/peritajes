import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Proxy endpoint for consulting a vehicle registry by plate.
 *
 * The Colombian RUNT registry does not expose a free public API, so this
 * endpoint is a neutral passthrough: if the operator has configured
 * `PLATE_LOOKUP_URL` (+ optional `PLATE_LOOKUP_API_KEY`) it will forward the
 * plate and expect a normalized response. Otherwise it returns 501 so the UI
 * can fall back cleanly to local history autocomplete.
 *
 * Expected upstream response shape (all fields optional):
 *   { plate, vin, make, model, year, color, fuel, bodyType, owner }
 */

type LookupResult = {
  plate?: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: string;
  color?: string;
  fuel?: string;
  bodyType?: string;
  owner?: string;
};

function normalize(raw: unknown): LookupResult {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const pick = (k: string): string | undefined => {
    const v = obj[k];
    return typeof v === "string" ? v : v == null ? undefined : String(v);
  };
  return {
    plate: pick("plate") ?? pick("placa"),
    vin: pick("vin") ?? pick("chasis"),
    make: pick("make") ?? pick("marca"),
    model: pick("model") ?? pick("modelo") ?? pick("linea"),
    year: pick("year") ?? pick("modeloAno") ?? pick("anio"),
    color: pick("color"),
    fuel: pick("fuel") ?? pick("combustible"),
    bodyType: pick("bodyType") ?? pick("carroceria"),
    owner: pick("owner") ?? pick("propietario"),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const plate = (url.searchParams.get("plate") || "").trim().toUpperCase();
  if (!plate) {
    return NextResponse.json({ error: "plate is required" }, { status: 400 });
  }

  const upstream = process.env.PLATE_LOOKUP_URL;
  if (!upstream) {
    return NextResponse.json(
      {
        configured: false,
        message:
          "Consulta externa no configurada. Configure PLATE_LOOKUP_URL para habilitar RUNT u otro proveedor.",
      },
      { status: 501 },
    );
  }

  try {
    const target = upstream.replace("{plate}", encodeURIComponent(plate));
    const finalUrl = target.includes(encodeURIComponent(plate))
      ? target
      : `${target}${target.includes("?") ? "&" : "?"}plate=${encodeURIComponent(plate)}`;

    const headers: Record<string, string> = { accept: "application/json" };
    if (process.env.PLATE_LOOKUP_API_KEY) {
      headers.authorization = `Bearer ${process.env.PLATE_LOOKUP_API_KEY}`;
    }

    const res = await fetch(finalUrl, {
      headers,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `upstream ${res.status}`, configured: true },
        { status: 502 },
      );
    }
    const raw = await res.json();
    return NextResponse.json({
      configured: true,
      plate,
      result: normalize(raw),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "upstream error";
    return NextResponse.json(
      { error: message, configured: true },
      { status: 502 },
    );
  }
}
