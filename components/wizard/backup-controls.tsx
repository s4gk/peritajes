"use client";

import * as React from "react";
import { Download, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  function handleExport() {
    const backup = exportAllInspections();
    if (backup.count === 0) {
      alert("No hay peritajes para exportar.");
      return;
    }
    const filename = `perito-backup-${todayStamp()}.json`;
    downloadFile(filename, JSON.stringify(backup, null, 2));
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
        alert(`Errores al importar:\n${result.errors.join("\n")}`);
      } else {
        alert(`Importación lista — ${summarize(result)}.`);
      }
      onChange?.();
    } catch (err) {
      alert(`No se pudo leer el archivo: ${(err as Error).message}`);
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
