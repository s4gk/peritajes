"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function InspectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  React.useEffect(() => {
    // Surface the full error in the browser console so it's easier to debug
    // in production (where React otherwise hides it behind "Application error").
    // eslint-disable-next-line no-console
    console.error("[inspection/error-boundary]", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-start justify-center gap-4 px-4 py-10">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div>
        <h1 className="text-xl font-semibold">No pudimos abrir este peritaje</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ocurrió un error cargando la inspección. Reintenta o vuelve al listado.
          Si se repite, abre la consola del navegador (F12) y envíale el mensaje
          completo a soporte.
        </p>
      </div>
      <pre className="w-full max-w-full overflow-auto rounded-md border bg-muted/60 p-3 font-mono text-xs">
        {error.message || "Error desconocido"}
        {error.digest ? `\n\ndigest: ${error.digest}` : ""}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button onClick={reset} className="gap-1.5">
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </Button>
        <Button variant="outline" onClick={() => router.push("/")} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" />
          Volver a peritajes
        </Button>
      </div>
    </div>
  );
}
