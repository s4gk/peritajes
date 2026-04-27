"use client";

import * as React from "react";
import { Camera, ChevronDown, ChevronUp } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { FINDING_CATALOGS, requiresPhoto } from "@/lib/findings-catalog";
import type { InspectedImage, InspectionEntry, InspectionItemDef } from "@/lib/types";
import { cn } from "@/lib/utils";

import { FindingSelector } from "./finding-selector";
import { ImageUpload, type ImageUploadHandle } from "./image-upload";
import { VoiceDictationButton } from "./voice-dictation-button";

type Props = {
  item: InspectionItemDef;
  entry: InspectionEntry | undefined;
  onChange: (next: InspectionEntry) => void;
};

export function InspectionItemRow({ item, entry, onChange }: Props) {
  const current: InspectionEntry = entry ?? { status: undefined, notes: "", images: [] };
  const catalog = FINDING_CATALOGS[item.kind];
  const photoRequired = requiresPhoto(current.status);
  const photoMissing = photoRequired && current.images.length === 0;
  const [expanded, setExpanded] = React.useState(false);
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

  // Auto-expand + open camera when a finding that requires a photo is picked
  // and there are no photos yet. Runs only on status change (not on remount).
  React.useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = current.status;
    if (prev === current.status) return;
    if (requiresPhoto(current.status) && current.images.length === 0) {
      setExpanded(true);
      // Delay so the ImageUpload is mounted (inside the expanded block)
      const t = window.setTimeout(() => uploadRef.current?.openPicker(), 60);
      return () => window.clearTimeout(t);
    }
  }, [current.status, current.images.length]);

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 transition-colors sm:p-4",
        photoMissing && "border-danger/60 bg-danger/5",
      )}
    >
      <div className="flex flex-col gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium sm:text-[15px]">{item.label}</div>
          {current.notes && !expanded && (
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {current.notes}
            </div>
          )}
        </div>

        <FindingSelector
          catalog={catalog}
          value={current.status}
          onChange={(v) => update({ status: v })}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md py-1.5 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              Ocultar detalles
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              Agregar nota o foto
            </>
          )}
        </button>
        <div className="flex items-center gap-3 text-xs">
          {photoMissing && (
            <span className="inline-flex items-center gap-1 font-semibold text-danger">
              <Camera className="h-3.5 w-3.5" />
              Foto obligatoria
            </span>
          )}
          {current.images.length > 0 && (
            <span className="text-muted-foreground">
              {current.images.length} foto{current.images.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {(expanded || photoRequired || current.images.length > 0) && (
        <div className="mt-3 space-y-3 border-t pt-3">
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
