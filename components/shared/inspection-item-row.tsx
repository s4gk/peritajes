"use client";

import * as React from "react";
import { Camera, ChevronDown } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import {
  FINDING_CATALOGS,
  findOption,
  minPhotosFor,
  type Tone,
} from "@/lib/findings-catalog";
import type {
  InspectedImage,
  InspectionEntry,
  InspectionItemDef,
  SealantState,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import { FindingSelector } from "./finding-selector";
import { ImageUpload, type ImageUploadHandle } from "./image-upload";
import { VoiceDictationButton } from "./voice-dictation-button";

const SEALANT_OPTIONS: { value: SealantState; label: string; hint: string }[] = [
  {
    value: "original",
    label: "Original",
    hint: "Sellante de fábrica, sin signos de intervención.",
  },
  {
    value: "generic",
    label: "Genérico",
    hint: "Sellante reaplicado o de reemplazo (indicio de retiro o reparación).",
  },
];

type Props = {
  item: InspectionItemDef;
  entry: InspectionEntry | undefined;
  onChange: (next: InspectionEntry) => void;
};

const CHIP_TONE: Record<Tone, string> = {
  success: "bg-success/10 text-success border-success/40",
  warning: "bg-warning/10 text-warning border-warning/40",
  danger: "bg-danger/10 text-danger border-danger/40",
  neutral: "bg-muted text-muted-foreground border-border",
};

export function InspectionItemRow({ item, entry, onChange }: Props) {
  const current: InspectionEntry = entry ?? { status: undefined, notes: "", images: [] };
  const catalog = FINDING_CATALOGS[item.kind];
  const selected = findOption(current.status);
  const photosNeeded = minPhotosFor(current.status);
  const photoRequired = photosNeeded > 0;
  const photoMissing = photoRequired && current.images.length < photosNeeded;
  const hasIssue = selected?.tone === "warning" || selected?.tone === "danger";
  // Default expanded if there's a hallazgo in progress (notes/photos relevant)
  // or if a photo is required but missing. Otherwise stay collapsed.
  const [expanded, setExpanded] = React.useState(() => photoMissing);
  const uploadRef = React.useRef<ImageUploadHandle>(null);
  const prevStatusRef = React.useRef<string | undefined>(current.status);

  function update(patch: Partial<InspectionEntry>) {
    onChange({ ...current, ...patch });
  }

  function setImages(images: InspectedImage[]) {
    update({ images });
  }

  function appendNote(text: string) {
    if (!text) return;
    const existing = current.notes ?? "";
    const sep = existing && !existing.endsWith(" ") && !existing.endsWith("\n") ? " " : "";
    update({ notes: `${existing}${sep}${text}`.trim() });
  }

  // Reactions to status changes:
  //   - status changed to a quick OK option (success/neutral) → collapse
  //   - status changed to a hallazgo → expand for notes/photo capture
  //   - photo is required but missing → auto-open camera picker
  React.useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = current.status;
    if (prev === current.status) return;
    const opt = findOption(current.status);
    if (!opt) return;
    if (opt.tone === "success" || opt.tone === "neutral") {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    const need = minPhotosFor(current.status);
    if (need > 0 && current.images.length < need) {
      const t = window.setTimeout(() => uploadRef.current?.openPicker(), 60);
      return () => window.clearTimeout(t);
    }
  }, [current.status, current.images.length]);

  return (
    <div
      data-item-id={item.id}
      className={cn(
        "rounded-lg border bg-card transition-colors",
        photoMissing && "border-danger/60 bg-danger/5",
        hasIssue && !photoMissing && "border-warning/40",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left sm:px-4"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium sm:text-[15px]">{item.label}</div>
          {current.notes && !expanded && (
            <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {current.notes}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {selected ? (
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-semibold sm:text-xs",
                CHIP_TONE[selected.tone],
              )}
            >
              {selected.label}
            </span>
          ) : (
            <span className="rounded-full border border-dashed border-muted-foreground/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              Pendiente
            </span>
          )}
          {item.hasSealantCheck && current.sealant && (
            <span
              className={cn(
                "hidden rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:inline-flex",
                current.sealant === "original"
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-warning/40 bg-warning/10 text-warning",
              )}
              title={`Sellante: ${current.sealant === "original" ? "Original" : "Genérico"}`}
            >
              Sellante {current.sealant === "original" ? "OG" : "GEN"}
            </span>
          )}
          {current.images.length > 0 && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {current.images.length} 📷
            </span>
          )}
          {photoMissing && (
            <span
              className="flex items-center gap-1 text-xs font-medium text-danger"
              aria-label={
                photosNeeded > 1
                  ? `Faltan fotos (${current.images.length}/${photosNeeded})`
                  : "Foto obligatoria"
              }
            >
              <Camera className="h-4 w-4" />
              {photosNeeded > 1 && (
                <span>{current.images.length}/{photosNeeded}</span>
              )}
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t px-3 pb-3 pt-3 sm:px-4">
          <FindingSelector
            catalog={catalog}
            value={current.status}
            onChange={(v) => update({ status: v })}
          />
          {item.hasSealantCheck && (
            <div className="rounded-md border bg-muted/30 p-2.5">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Sellante del marco
                </span>
                {current.sealant && (
                  <button
                    type="button"
                    onClick={() => update({ sealant: undefined })}
                    className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Limpiar
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SEALANT_OPTIONS.map((opt) => {
                  const active = current.sealant === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => update({ sealant: opt.value })}
                      title={opt.hint}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        active
                          ? opt.value === "original"
                            ? "border-success/60 bg-success/15 text-success"
                            : "border-warning/60 bg-warning/15 text-warning"
                          : "border-border bg-card text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                {current.sealant === "generic"
                  ? "Sellante genérico — indicio de que la puerta fue removida o reemplazada."
                  : current.sealant === "original"
                    ? "Sellante original de fábrica."
                    : "Calificá el sellante visible en el marco para detectar intervenciones."}
              </p>
            </div>
          )}
          <div className="relative">
            <Textarea
              placeholder="Observaciones (opcional)"
              value={current.notes ?? ""}
              onChange={(e) => update({ notes: e.target.value })}
              rows={2}
              className="pr-11"
            />
            <div className="absolute right-1.5 top-1.5">
              <VoiceDictationButton onTranscript={appendNote} />
            </div>
          </div>
          <ImageUpload
            ref={uploadRef}
            images={current.images}
            onChange={setImages}
            required={photoRequired}
            compact
          />
        </div>
      )}
    </div>
  );
}
