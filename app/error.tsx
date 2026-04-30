"use client";

import * as React from "react";
import Link from "next/link";
import { AlertOctagon, Home, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[app/error-boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
          <AlertOctagon className="h-6 w-6" />
        </div>
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          Algo salió mal
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Ocurrió un error procesando tu solicitud. Reintenta, y si se repite
          revisa la consola (F12) y manda el mensaje a soporte.
        </p>
        <pre className="mt-4 max-w-full overflow-auto rounded-md border bg-muted/60 p-3 text-xs">
          {error.message || "Error desconocido"}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" /> Reintentar
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            <Home className="h-4 w-4" /> Inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
