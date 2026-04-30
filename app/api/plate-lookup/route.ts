import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";
import {
  clientIpFromHeaders,
  rateLimitMaybeSweep,
  rateLimitTake,
} from "@/lib/server/rate-limit";
import {
  getFasecoldaCache,
  getRuntCache,
  putFasecoldaCache,
  putRuntCache,
  sweepExpired,
} from "@/lib/server/verifik-cache";
import { fasecoldaToVehicleSeed } from "@/lib/verifik/fasecolda";
import { runtToVehicleSeed } from "@/lib/verifik/runt";
import { mergeVerifikSeeds } from "@/lib/verifik/merge";
import {
  fetchFasecolda,
  fetchRunt,
  VerifikError,
} from "@/lib/verifik/client";
import type {
  FasecoldaResponse,
  RuntResponse,
  VerifikSnapshot,
} from "@/lib/verifik/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plate-lookup endpoint backed by Verifik (FASECOLDA + RUNT) with a
 * Postgres-backed cache.
 *
 * Parameters:
 *   - plate (required)
 *   - documentType + documentNumber (required for RUNT)
 *   - force=1 (optional) — bypass cache and force a live call
 *
 * Cache strategy: each (service, plate, doc_key) tuple is stored after the
 * first successful call. Re-queries within VERIFIK_CACHE_TTL_HOURS (default
 * 7 days) hit the DB instead of Verifik — $0 cost.
 *
 * The rate limit only counts LIVE calls, so cache hits don't burn the
 * user's hourly quota either. If the live call fails, the cache is not
 * touched.
 */

const LOOKUP_LIMIT = { windowMs: 60 * 60 * 1000, max: 30 };

export async function GET(request: Request) {
  rateLimitMaybeSweep();
  void sweepExpired();

  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const plate = (url.searchParams.get("plate") || "").trim().toUpperCase();
  const documentType = (url.searchParams.get("documentType") || "").trim();
  const documentNumber = (url.searchParams.get("documentNumber") || "").trim();
  const force = url.searchParams.get("force") === "1";

  if (!plate) {
    return NextResponse.json({ error: "plate is required" }, { status: 400 });
  }

  const wantsRunt = !!documentType && !!documentNumber;
  const warnings: string[] = [];
  const fromCache: { fasecolda: boolean; runt: boolean } = {
    fasecolda: false,
    runt: false,
  };

  // Try cache first (unless ?force=1). Important: this runs BEFORE the
  // VERIFIK_TOKEN check — a fully-cached lookup costs $0 and shouldn't
  // require a configured token to serve.
  let fasecolda: FasecoldaResponse | null = null;
  let runt: RuntResponse | null = null;

  if (!force) {
    const fhit = await getFasecoldaCache(plate);
    if (fhit.hit) {
      fasecolda = fhit.response;
      fromCache.fasecolda = true;
    }
    if (wantsRunt) {
      const rhit = await getRuntCache(plate, documentType, documentNumber);
      if (rhit.hit) {
        runt = rhit.response;
        fromCache.runt = true;
      }
    }
  }

  const needFasecolda = !fasecolda;
  const needRunt = wantsRunt && !runt;

  // Token is only required for live calls. If everything's cached, skip.
  const token = process.env.VERIFIK_TOKEN;
  if ((needFasecolda || needRunt) && !token) {
    // If we DO have something cached, return that and warn about the rest.
    if (fasecolda || runt) {
      warnings.push(
        "Verifik no está configurado: solo se devolvió data desde cache.",
      );
    } else {
      return NextResponse.json(
        {
          configured: false,
          message:
            "Verifik no está configurado. Define VERIFIK_TOKEN en el servidor para habilitar las consultas.",
        },
        { status: 501 },
      );
    }
  }

  // Only check rate limit if we're going to do a live call. Cache-only
  // responses cost nothing so they don't count against the user's quota.
  if ((needFasecolda || needRunt) && token) {
    const limit = rateLimitTake(`lookup:${user.id}`, LOOKUP_LIMIT);
    if (!limit.allowed) {
      await logAudit(
        user.id,
        "lookup.rate_limited",
        JSON.stringify({ plate, retryAfterSec: limit.retryAfterSec }),
      );
      return NextResponse.json(
        {
          error: `Has alcanzado el límite de consultas (${LOOKUP_LIMIT.max} por hora). Vuelve a intentarlo en ${Math.ceil(limit.retryAfterSec / 60)} minutos.`,
        },
        {
          status: 429,
          headers: { "retry-after": String(limit.retryAfterSec) },
        },
      );
    }
  }

  // Live calls (only for what's not in cache AND we have a token)
  if ((needFasecolda || needRunt) && token) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const [fResult, rResult] = await Promise.allSettled([
        needFasecolda
          ? fetchFasecolda(plate, token, controller.signal)
          : Promise.resolve(null),
        needRunt
          ? fetchRunt(
              { documentType, documentNumber, plate },
              token,
              controller.signal,
            )
          : Promise.resolve(null),
      ]);

      if (needFasecolda) {
        if (fResult.status === "fulfilled" && fResult.value) {
          fasecolda = fResult.value;
          // Persist before any further work — if mapping below throws, we
          // don't lose the paid response.
          await putFasecoldaCache(plate, fasecolda);
        } else if (fResult.status === "rejected") {
          const reason = fResult.reason;
          warnings.push(
            reason instanceof VerifikError
              ? `FASECOLDA falló (${reason.status}): ${reason.message}`
              : `FASECOLDA no respondió: ${(reason as Error)?.message ?? "error desconocido"}`,
          );
        }
      }

      if (needRunt) {
        if (rResult.status === "fulfilled" && rResult.value) {
          runt = rResult.value;
          await putRuntCache(plate, documentType, documentNumber, runt);
        } else if (rResult.status === "rejected") {
          const reason = rResult.reason;
          warnings.push(
            reason instanceof VerifikError
              ? `RUNT falló (${reason.status}): ${reason.message}`
              : `RUNT no respondió: ${(reason as Error)?.message ?? "error desconocido"}`,
          );
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  // Build snapshot + seed from whatever we have (cache + live)
  const snapshot: VerifikSnapshot = {
    queriedAt: new Date().toISOString(),
    documentType: wantsRunt ? documentType : undefined,
    documentNumber: wantsRunt ? documentNumber : undefined,
    fasecolda,
    runt,
  };

  const seed = mergeVerifikSeeds(
    runt ? runtToVehicleSeed(runt) : {},
    fasecolda ? fasecoldaToVehicleSeed(fasecolda) : {},
  );

  if (!fasecolda && !runt) {
    await logAudit(
      user.id,
      "lookup.failed",
      JSON.stringify({ plate, calls: wantsRunt ? "fasecolda+runt" : "fasecolda" }),
    );
    return NextResponse.json(
      { configured: true, plate, error: "Ambas consultas fallaron", warnings },
      { status: 502 },
    );
  }

  // Audit: live calls vs cache hits separately so consumption monitoring
  // matches what Verifik will actually invoice.
  const liveCalls: string[] = [];
  if (needFasecolda && fasecolda) liveCalls.push("fasecolda");
  if (needRunt && runt) liveCalls.push("runt");
  if (liveCalls.length > 0) {
    await logAudit(
      user.id,
      "lookup.success",
      JSON.stringify({
        plate,
        calls: liveCalls,
        warnings: warnings.length,
      }),
    );
  } else {
    await logAudit(
      user.id,
      "lookup.cache_hit",
      JSON.stringify({
        plate,
        services: [
          fromCache.fasecolda ? "fasecolda" : null,
          fromCache.runt ? "runt" : null,
        ].filter(Boolean),
      }),
    );
  }

  return NextResponse.json({
    configured: true,
    plate,
    result: seed,
    snapshot,
    warnings,
    fromCache,
  });
}
