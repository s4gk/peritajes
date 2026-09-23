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
 *
 * Hasta montar pintamos lo mismo que pintó el server: el HTML del cascarón se
 * generó con la ruta `/inspection/offline-shell`, y si el primer render del
 * cliente dependiera del id real React daría error de hidratación.
 */
export function WizardFromUrl() {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const id = inspectionIdFromPath(pathname);
  if (!mounted) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Cargando inspección...
      </div>
    );
  }
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
