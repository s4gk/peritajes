import { NextResponse } from "next/server";

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
 */
export async function GET(request: Request) {
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
      return NextResponse.json(
        { configured: true, plate, error: "Ambas consultas fallaron", warnings },
        { status: 502 },
      );
    }

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
