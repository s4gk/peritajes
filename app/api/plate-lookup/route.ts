import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";
import {
  clientIpFromHeaders,
  rateLimitMaybeSweep,
  rateLimitTake,
} from "@/lib/server/rate-limit";
import { fasecoldaToVehicleSeed } from "@/lib/verifik/fasecolda";
import { runtToVehicleSeed } from "@/lib/verifik/runt";
import { mergeVerifikSeeds } from "@/lib/verifik/merge";
import {
  fetchFasecolda,
  fetchRunt,
  VerifikError,
} from "@/lib/verifik/client";
import type { VerifikSnapshot } from "@/lib/verifik/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plate-lookup endpoint backed by Verifik (FASECOLDA + RUNT).
 *
 * Parameters:
 *   - plate (required)
 *   - documentType + documentNumber (required for RUNT — Habeas Data gating)
 *
 * If only `plate` is supplied we run FASECOLDA only (legacy single-button
 * behavior). When both document parts are present we run BOTH calls in
 * parallel and merge them so the wizard gets vin/year/color/etc. from RUNT
 * plus rich trim and market value from FASECOLDA.
 *
 * Failure mode is partial-on-purpose: if one of the two calls fails, the
 * other's result is still returned with a `warnings` entry. The user already
 * paid for the call that succeeded; throwing it away would be silly.
 *
 * Cost gating:
 *  - Requires a logged-in user (cookie session). Anonymous calls would burn
 *    Verifik credits at $0.40/call FASECOLDA.
 *  - Rate-limited per user to LOOKUP_LIMIT (sliding hour window) so a
 *    runaway loop or compromised account can't drain credits.
 *  - Every successful call writes to audit_log with placa + cost meta.
 */

const LOOKUP_LIMIT = { windowMs: 60 * 60 * 1000, max: 30 };

export async function GET(request: Request) {
  rateLimitMaybeSweep();

  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json(
      { error: "No autenticado" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const plate = (url.searchParams.get("plate") || "").trim().toUpperCase();
  const documentType = (url.searchParams.get("documentType") || "").trim();
  const documentNumber = (url.searchParams.get("documentNumber") || "").trim();

  if (!plate) {
    return NextResponse.json({ error: "plate is required" }, { status: 400 });
  }

  const token = process.env.VERIFIK_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        configured: false,
        message:
          "Verifik no está configurado. Define VERIFIK_TOKEN en el servidor para habilitar las consultas.",
      },
      { status: 501 },
    );
  }

  // Per-user rate limit. We bucket by user id (not IP) so a perito on a
  // shared NAT can't be locked out by a colleague — and an attacker who
  // steals a session can't move to a fresh IP to bypass it.
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

  const wantsRunt = !!documentType && !!documentNumber;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  const warnings: string[] = [];
  const snapshot: VerifikSnapshot = {
    queriedAt: new Date().toISOString(),
    documentType: wantsRunt ? documentType : undefined,
    documentNumber: wantsRunt ? documentNumber : undefined,
  };

  try {
    const [fasecoldaResult, runtResult] = await Promise.allSettled([
      fetchFasecolda(plate, token, controller.signal),
      wantsRunt
        ? fetchRunt({ documentType, documentNumber, plate }, token, controller.signal)
        : Promise.resolve(null),
    ]);

    if (fasecoldaResult.status === "fulfilled") {
      snapshot.fasecolda = fasecoldaResult.value;
    } else {
      const reason = fasecoldaResult.reason;
      warnings.push(
        reason instanceof VerifikError
          ? `FASECOLDA falló (${reason.status}): ${reason.message}`
          : `FASECOLDA no respondió: ${(reason as Error)?.message ?? "error desconocido"}`,
      );
    }

    if (wantsRunt) {
      if (runtResult.status === "fulfilled" && runtResult.value) {
        snapshot.runt = runtResult.value;
      } else if (runtResult.status === "rejected") {
        const reason = runtResult.reason;
        warnings.push(
          reason instanceof VerifikError
            ? `RUNT falló (${reason.status}): ${reason.message}`
            : `RUNT no respondió: ${(reason as Error)?.message ?? "error desconocido"}`,
        );
      }
    }

    const seed = mergeVerifikSeeds(
      snapshot.runt ? runtToVehicleSeed(snapshot.runt) : {},
      snapshot.fasecolda ? fasecoldaToVehicleSeed(snapshot.fasecolda) : {},
    );

    if (!snapshot.fasecolda && !snapshot.runt) {
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

    // Audit each chargeable call so consumption can be reconciled with
    // Verifik's own dashboard / invoice.
    const calls: string[] = [];
    if (snapshot.fasecolda) calls.push("fasecolda");
    if (snapshot.runt) calls.push("runt");
    await logAudit(
      user.id,
      "lookup.success",
      JSON.stringify({ plate, calls, warnings: warnings.length }),
    );

    return NextResponse.json({
      configured: true,
      plate,
      result: seed,
      snapshot,
      warnings,
    });
  } finally {
    clearTimeout(timeout);
  }
}
