"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, EyeOff, RotateCcw, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { BodyworkCoords, PanelCoord } from "@/lib/bodywork-coords";

export type PanelMeta = { id: string; label: string; group: string };

type State = Record<string, PanelCoord | null | undefined>;

export function CalibrateClient({
  slug,
  imageUrl,
  panels,
  allPanelIds,
  initial,
}: {
  slug: string;
  imageUrl: string;
  panels: PanelMeta[];
  allPanelIds: string[];
  initial: BodyworkCoords | null;
}) {
  const [coords, setCoords] = React.useState<State>(() => {
    const out: State = {};
    for (const id of allPanelIds) {
      out[id] = initial?.panels?.[id] ?? undefined;
    }
    return out;
  });
  const [activePanel, setActivePanel] = React.useState<string | null>(panels[0]?.id ?? null);
  const [imageDims, setImageDims] = React.useState<{ width: number; height: number } | null>(
    initial?.image ?? null,
  );
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<string | null>(initial?.calibratedAt ?? null);
  const imgRef = React.useRef<HTMLImageElement>(null);

  function handleImageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!activePanel) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const clamped = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    setCoords((prev) => ({ ...prev, [activePanel]: clamped }));
    // Auto-advance to next undefined panel
    const nextIdx = panels.findIndex((p) => p.id === activePanel);
    for (let i = 1; i <= panels.length; i++) {
      const candidate = panels[(nextIdx + i) % panels.length];
      if (coords[candidate.id] === undefined) {
        setActivePanel(candidate.id);
        return;
      }
    }
  }

  function markNotVisible(id: string) {
    setCoords((prev) => ({ ...prev, [id]: null }));
    if (activePanel === id) {
      const idx = panels.findIndex((p) => p.id === id);
      const next = panels.slice(idx + 1).find((p) => coords[p.id] === undefined);
      if (next) setActivePanel(next.id);
    }
  }

  function clearPanel(id: string) {
    setCoords((prev) => ({ ...prev, [id]: undefined }));
    setActivePanel(id);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, PanelCoord | null> = {};
      for (const [id, val] of Object.entries(coords)) {
        if (val === undefined) continue; // pending = exclude
        payload[id] = val;
      }
      const res = await fetch("/api/bodywork-coords", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug,
          panels: payload,
          image: imageDims,
        }),
      });
      const body = (await res.json()) as { status?: string; error?: string };
      if (!res.ok || body.status !== "saved") {
        alert(`No se pudo guardar: ${body.error || res.status}`);
        return;
      }
      setSavedAt(new Date().toISOString());
    } finally {
      setSaving(false);
    }
  }

  const placedCount = panels.filter((p) => coords[p.id] && coords[p.id] !== null).length;
  const skippedCount = panels.filter((p) => coords[p.id] === null).length;
  const pendingCount = panels.length - placedCount - skippedCount;

  return (
    <div className="mx-auto max-w-7xl space-y-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" /> Volver
          </Link>
          <div>
            <h1 className="text-base font-semibold sm:text-lg">Calibración de carrocería</h1>
            <p className="text-xs text-muted-foreground">
              <code className="font-mono">{slug}</code>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && (
            <span className="hidden items-center gap-1.5 text-xs text-emerald-600 sm:inline-flex">
              <CheckCircle2 className="h-3.5 w-3.5" /> Guardado
            </span>
          )}
          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-1.5 h-4 w-4" />
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr,360px]">
        <div className="space-y-2">
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">
              {activePanel
                ? `Haz clic en la imagen donde está: ${panels.find((p) => p.id === activePanel)?.label}`
                : "Selecciona un panel de la lista para marcar su posición."}
            </p>
          </div>
          <div
            className="relative overflow-hidden rounded-lg border bg-black"
            onClick={handleImageClick}
            style={{ cursor: activePanel ? "crosshair" : "default" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Vehículo generado"
              className="block h-auto w-full select-none"
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget;
                setImageDims({ width: el.naturalWidth, height: el.naturalHeight });
              }}
            />
            {panels.map((p) => {
              const c = coords[p.id];
              if (!c) return null;
              return (
                <span
                  key={p.id}
                  className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
                    activePanel === p.id
                      ? "border-amber-300 bg-amber-400 ring-2 ring-amber-300/50"
                      : "border-white bg-primary"
                  }`}
                  style={{
                    left: `${c.x * 100}%`,
                    top: `${c.y * 100}%`,
                    width: 18,
                    height: 18,
                  }}
                  title={p.label}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>
              <strong className="text-foreground">{placedCount}</strong> ubicados
            </span>
            <span>
              <strong className="text-foreground">{skippedCount}</strong> no visibles
            </span>
            <span>
              <strong className="text-foreground">{pendingCount}</strong> pendientes
            </span>
          </div>
        </div>

        <div className="space-y-3">
          {groupBy(panels).map((group) => (
            <div key={group.label} className="rounded-lg border bg-card">
              <div className="border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </div>
              <ul>
                {group.items.map((p) => {
                  const c = coords[p.id];
                  const isActive = activePanel === p.id;
                  const status =
                    c === null
                      ? "skipped"
                      : c === undefined
                        ? "pending"
                        : "placed";
                  return (
                    <li
                      key={p.id}
                      className={`flex items-center gap-2 border-b px-3 py-2 last:border-b-0 ${
                        isActive ? "bg-amber-50 dark:bg-amber-950/20" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActivePanel(p.id)}
                        className="flex-1 text-left text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <StatusDot status={status} />
                          <span
                            className={
                              status === "skipped"
                                ? "text-muted-foreground line-through"
                                : "font-medium"
                            }
                          >
                            {p.label}
                          </span>
                        </div>
                      </button>
                      {status === "placed" && (
                        <button
                          type="button"
                          onClick={() => clearPanel(p.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent"
                          title="Borrar marca"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {status !== "skipped" && (
                        <button
                          type="button"
                          onClick={() => markNotVisible(p.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent"
                          title="Marcar como no visible en esta vista"
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: "placed" | "skipped" | "pending" }) {
  const cls =
    status === "placed"
      ? "bg-emerald-500"
      : status === "skipped"
        ? "bg-muted-foreground/40"
        : "bg-amber-400";
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} aria-hidden />;
}

function groupBy(panels: PanelMeta[]): { label: string; items: PanelMeta[] }[] {
  const map = new Map<string, PanelMeta[]>();
  for (const p of panels) {
    if (!map.has(p.group)) map.set(p.group, []);
    map.get(p.group)!.push(p);
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
}
