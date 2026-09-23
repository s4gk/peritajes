"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { navigateOfflineSafe } from "@/lib/client/offline-nav";
import { inspectionIdFromPath } from "@/lib/offline-routes";

import { Wizard } from "./wizard";

/**
 * Monta el wizard con el id que viene en la URL del navegador. `usePathname`
 * refleja la URL real (Next 14 inicializa el router desde `location.href`),
 * no la del HTML cacheado, así que funciona igual cuando el SW sirve el
 * cascarón sin red.
 */
export function WizardFromUrl() {
  const pathname = usePathname();
  const router = useRouter();
  const id = inspectionIdFromPath(pathname);
  if (!id) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <div className="text-lg font-semibold">Peritaje no encontrado</div>
        <Button onClick={() => navigateOfflineSafe(router, "/peritajes")}>
          Volver a peritajes
        </Button>
      </div>
    );
  }
  return <Wizard key={id} id={id} />;
}
