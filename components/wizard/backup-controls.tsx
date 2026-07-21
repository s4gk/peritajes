"use client";

import * as React from "react";
import { Download, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  exportAllInspections,
  importInspections,
  type ImportResult,
} from "@/lib/inspections-store";

function downloadFile(filename: string, content: string, mime = "application/json") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function todayStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function summarize(r: ImportResult): string {
  const parts: string[] = [];
  if (r.added) parts.push(`${r.added} nuevos`);
  if (r.updated) parts.push(`${r.updated} actualizados`);
  if (r.skipped) parts.push(`${r.skipped} sin cambios`);
  if (r.errors.length) parts.push(`${r.errors.length} errores`);
  return parts.length ? parts.join(" · ") : "Nada para importar";
}

export function BackupControls({ onChange }: { onChange?: () => void }) {
  const toast = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  function handleExport() {
    const backup = exportAllInspections();
    if (backup.count === 0) {
      toast.show({
        title: "No hay nada para exportar",
        description: "Todavía no tienes peritajes guardados en este dispositivo.",
        variant: "warning",
      });
      return;
    }
    const filename = `perito-backup-${todayStamp()}.json`;
    downloadFile(filename, JSON.stringify(backup, null, 2));
    toast.show({
      title: "Respaldo descargado",
      description: `${backup.count} peritaje${backup.count === 1 ? "" : "s"} en ${filename}`,
      variant: "success",
    });
  }

  function handlePickFile() {
    fileInputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const result = await importInspections(text, "merge");
      if (result.errors.length) {
        // Solo los primeros: el toast no es un visor de logs, y una lista de
        // 40 errores lo volvería una pared de texto ilegible.
        const shown = result.errors.slice(0, 3).join(" · ");
        const rest = result.errors.length - 3;
        toast.show({
          title: `La importación terminó con ${result.errors.length} error${result.errors.length === 1 ? "" : "es"}`,
          description: rest > 0 ? `${shown} · y ${rest} más` : shown,
          variant: "danger",
        });
      } else {
        toast.show({
          title: "Importación lista",
          description: summarize(result),
          variant: "success",
        });
      }
      onChange?.();
    } catch (err) {
      toast.show({
        title: "No se pudo leer el archivo",
        description:
          err instanceof Error
            ? err.message
            : "Revisa que sea un respaldo de Perito en formato JSON.",
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleFile}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-10 gap-1.5"
        onClick={handleExport}
        title="Descargar respaldo JSON con todos los peritajes"
      >
        <Download className="h-4 w-4" />
        <span className="hidden sm:inline">Exportar</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-10 gap-1.5"
        onClick={handlePickFile}
        disabled={busy}
        title="Importar respaldo JSON (fusiona con los actuales)"
      >
        <Upload className="h-4 w-4" />
        <span className="hidden sm:inline">{busy ? "Importando…" : "Importar"}</span>
      </Button>
    </>
  );
}
