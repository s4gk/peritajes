"use client";

import * as React from "react";
import { ShieldAlert } from "lucide-react";

import { crossCheckVerifik, type Mismatch } from "@/lib/verifik/cross-check";
import type { VehicleInfo } from "@/lib/types";
import type { VerifikSnapshot } from "@/lib/verifik/types";

type Props = {
  vehicle: VehicleInfo;
  verifik: VerifikSnapshot | undefined;
  /** Variante compacta para summary — sin lista detallada, solo título + badge. */
  compact?: boolean;
};

export function VerifikMismatchBanner({ vehicle, verifik, compact }: Props) {
  const mismatches = React.useMemo(
    () => crossCheckVerifik(vehicle, verifik),
    [vehicle, verifik],
  );
  if (!verifik?.runt) return null;
  if (mismatches.length === 0) return null;

  if (compact) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <span className="font-semibold">
            {mismatches.length}{" "}
            {mismatches.length === 1 ? "discrepancia" : "discrepancias"} con RUNT
          </span>{" "}
          en {mismatches.map((m) => m.label).join(", ")}.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
      <div className="mb-2 flex items-center gap-2 text-warning">
        <ShieldAlert className="h-5 w-5" />
        <div className="font-semibold">
          {mismatches.length === 1
            ? "Hay una discrepancia con RUNT"
            : `Hay ${mismatches.length} discrepancias con RUNT`}
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Lo capturado en el peritaje no coincide con lo que devolvió la consulta
        oficial. Revisalo — puede ser un typo o una señal de alteración (gemeleo,
        re-marcación de chasis o motor).
      </p>
      <div className="space-y-2">
        {mismatches.map((m) => (
          <MismatchRow key={m.field} m={m} />
        ))}
      </div>
    </div>
  );
}

function MismatchRow({ m }: { m: Mismatch }) {
  return (
    <div className="grid gap-1 rounded border border-warning/30 bg-card px-3 py-2 sm:grid-cols-[120px_1fr_1fr]">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {m.label}
      </div>
      <div className="text-sm">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Capturado:
        </span>{" "}
        <span className="font-mono">{m.capturedLabel || "—"}</span>
      </div>
      <div className="text-sm">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          RUNT:
        </span>{" "}
        <span className="font-mono">{m.expected || "—"}</span>
      </div>
    </div>
  );
}
