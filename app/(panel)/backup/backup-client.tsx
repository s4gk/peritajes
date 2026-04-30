"use client";

import * as React from "react";
import { DatabaseBackup, Info } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BackupControls } from "@/components/wizard/backup-controls";
import { initStore, listInspections } from "@/lib/inspections-store";

export function BackupClient() {
  const [count, setCount] = React.useState<number | null>(null);

  const refresh = React.useCallback(async () => {
    await initStore();
    setCount(listInspections().length);
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="container max-w-3xl space-y-5 py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Backup
        </h1>
        <p className="text-sm text-muted-foreground">
          Exporta todos los peritajes a un archivo JSON o restaura desde uno.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <DatabaseBackup className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">
                {count === null
                  ? "Cargando..."
                  : `${count} peritaje${count === 1 ? "" : "s"} en este dispositivo`}
              </CardTitle>
              <CardDescription>
                Los datos están en este navegador (IndexedDB). Haz backup con
                frecuencia.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <BackupControls onChange={refresh} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex gap-3 py-4 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1.5 text-muted-foreground">
            <p>
              <strong className="text-foreground">Formato:</strong> JSON con
              versión y todos los peritajes.
            </p>
            <p>
              <strong className="text-foreground">Importar:</strong> los
              peritajes con el mismo ID se actualizan si el backup es más nuevo;
              los nuevos se agregan.
            </p>
            <p>
              <strong className="text-foreground">Recomendación:</strong>{" "}
              guarda el archivo en Drive, Dropbox o disco externo después de
              cada jornada.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
