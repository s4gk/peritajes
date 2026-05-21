"use client";

import * as React from "react";
import { Camera, ChevronDown } from "lucide-react";

import { FindingSelector } from "@/components/shared/finding-selector";
import { ImageUpload, type ImageUploadHandle } from "@/components/shared/image-upload";
import { InspectionItemRow } from "@/components/shared/inspection-item-row";
import { VoiceDictationButton } from "@/components/shared/voice-dictation-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  activeSectionsFor,
  COMFORT_SECTION,
  WALKAROUND_STAGES,
  walkaroundSequenceFor,
  type SectionId,
  type WalkaroundEntry,
  type WalkaroundStageId,
} from "@/lib/constants";
import {
  FINDING_CATALOGS,
  findOption,
  minPhotosFor,
  RIM_CATALOG,
  type Tone,
} from "@/lib/findings-catalog";
import { cn } from "@/lib/utils";
import type {
  InspectedImage,
  InspectionEntry,
  InspectionItemDef,
  ItemKind,
  RimEntry,
  RimMaterial,
  RimOrigin,
  TirePosition,
} from "@/lib/types";

const CHIP_TONE: Record<Tone, string> = {
  success: "bg-success/10 text-success border-success/40",
  warning: "bg-warning/10 text-warning border-warning/40",
  danger: "bg-danger/10 text-danger border-danger/40",
  neutral: "bg-muted text-muted-foreground border-border",
};

import { AccessoriesStep } from "./accessories";
import { useInspection } from "../inspection-context";

const TIRE_DEPTH_KEYS: Record<
  TirePosition,
  "frontLeft" | "frontRight" | "rearLeft" | "rearRight" | "spare"
> = {
  fl: "frontLeft",
  fr: "frontRight",
  rl: "rearLeft",
  rr: "rearRight",
  spare: "spare",
};

const RIM_MATERIAL_OPTIONS: { value: RimMaterial; label: string }[] = [
  { value: "steel", label: "Acero" },
  { value: "aluminum", label: "Aluminio" },
  { value: "magnesium", label: "Magnesio" },
];

const RIM_ORIGIN_OPTIONS: {
  value: RimOrigin;
  label: string;
  tone: "success" | "warning";
}[] = [
  { value: "original", label: "Original", tone: "success" },
  { value: "replica", label: "Réplica", tone: "warning" },
  { value: "aftermarket", label: "Aftermarket", tone: "warning" },
];

const LIGHT_UNIT_ITEM_IDS = new Set<string>([
  "taillight_l",
  "taillight_r",
  "headlight_l",
  "headlight_r",
]);

const PANORAMIC_ITEM_IDS = new Set<string>([
  "windshield",
  "windshield_l",
  "windshield_r",
  "rear_window",
]);

function itemKindFor(sectionId: SectionId, itemId: string): ItemKind {
  if (sectionId === "bodywork") {
    if (LIGHT_UNIT_ITEM_IDS.has(itemId)) return "light_unit";
    if (PANORAMIC_ITEM_IDS.has(itemId)) return "panoramic";
    return "bodywork";
  }
  if (sectionId === "chassis") return "structural";
  if (sectionId === "leaks") return "leak";
  return "mechanical";
}

function depthTone(pct: number): string {
  if (pct <= 25) return "text-danger";
  if (pct <= 50) return "text-warning";
  return "text-success";
}

export function WalkaroundStep({ stage }: { stage: WalkaroundStageId }) {
  const { data } = useInspection();
  const stageDef = WALKAROUND_STAGES.find((s) => s.id === stage);
  const entries = React.useMemo(() => {
    const active = activeSectionsFor(data.kind, data.vehicleType);
    const seq = walkaroundSequenceFor(data.vehicleType, active);
    return seq.filter((e) => e.stage === stage);
  }, [data.kind, data.vehicleType, stage]);

  if (!stageDef || entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Etapa sin items</CardTitle>
          <CardDescription>
            No hay items para esta etapa con la configuración actual del
            peritaje.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{stageDef.label}</CardTitle>
        <CardDescription>{stageDef.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {entries.map((entry, idx) => (
          <WalkaroundRow key={rowKey(entry, idx)} entry={entry} />
        ))}
      </CardContent>
    </Card>
  );
}

function rowKey(entry: WalkaroundEntry, idx: number): string {
  if (entry.kind === "item") return `${idx}-${entry.sectionId}-${entry.itemId}`;
  if (entry.kind === "tire") return `${idx}-tire-${entry.position}`;
  return `${idx}-compound-${entry.compoundKey}`;
}

function WalkaroundRow({ entry }: { entry: WalkaroundEntry }) {
  if (entry.kind === "item") return <ItemRow entry={entry} />;
  if (entry.kind === "tire") return <TireRow entry={entry} />;
  return <CompoundRow entry={entry} />;
}

function ItemRow({
  entry,
}: {
  entry: Extract<WalkaroundEntry, { kind: "item" }>;
}) {
  const { data, setData } = useInspection();
  const bucket = data[entry.sectionId] as
    | Record<string, InspectionEntry>
    | undefined;
  const current = bucket?.[entry.itemId];

  const itemDef: InspectionItemDef = React.useMemo(
    () => ({
      id: entry.itemId,
      label: entry.label,
      kind: itemKindFor(entry.sectionId, entry.itemId),
    }),
    [entry.itemId, entry.label, entry.sectionId],
  );

  const handleChange = React.useCallback(
    (next: InspectionEntry) => {
      setData((prev) => {
        const prevBucket =
          (prev[entry.sectionId] as Record<string, InspectionEntry>) ?? {};
        return {
          ...prev,
          [entry.sectionId]: { ...prevBucket, [entry.itemId]: next },
        };
      });
    },
    [entry.itemId, entry.sectionId, setData],
  );

  return (
    <InspectionItemRow item={itemDef} entry={current} onChange={handleChange} />
  );
}

function TireRow({
  entry,
}: {
  entry: Extract<WalkaroundEntry, { kind: "tire" }>;
}) {
  const { data, setData } = useInspection();
  const depthKey = TIRE_DEPTH_KEYS[entry.position];
  const depth = data.tires[depthKey] ?? 0;
  const finding = data.tires.findings?.[entry.position];
  const current: InspectionEntry =
    finding ?? { status: undefined, notes: "", images: [] };
  const rim: RimEntry = data.tires.rims?.[entry.position] ?? {};

  const catalog = FINDING_CATALOGS.mechanical;
  const selected = findOption(current.status);
  const rimSelected = findOption(rim.status);
  // Fotos compartidas entre llanta y rin: tomamos el mayor requerimiento
  // de ambos. Si el rin está doblado (sev 3 → 2 fotos) pero la llanta OK,
  // igual exigimos 2 fotos para soportar el hallazgo del rin.
  const photosNeeded = Math.max(
    minPhotosFor(current.status),
    minPhotosFor(rim.status),
  );
  const photoRequired = photosNeeded > 0;
  const photoMissing = photoRequired && current.images.length < photosNeeded;
  const hasIssue =
    selected?.tone === "warning" ||
    selected?.tone === "danger" ||
    rimSelected?.tone === "warning" ||
    rimSelected?.tone === "danger";

  const [expanded, setExpanded] = React.useState(() => photoMissing);
  const uploadRef = React.useRef<ImageUploadHandle>(null);
  const prevStatusRef = React.useRef<string | undefined>(current.status);

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

  const updateDepth = React.useCallback(
    (v: number) => {
      setData((prev) => ({
        ...prev,
        tires: { ...prev.tires, [depthKey]: v },
      }));
    },
    [depthKey, setData],
  );

  const updateFinding = React.useCallback(
    (patch: Partial<InspectionEntry>) => {
      setData((prev) => {
        const prevFinding: InspectionEntry =
          prev.tires.findings?.[entry.position] ?? {
            status: undefined,
            notes: "",
            images: [],
          };
        return {
          ...prev,
          tires: {
            ...prev.tires,
            findings: {
              ...(prev.tires.findings ?? {}),
              [entry.position]: { ...prevFinding, ...patch },
            },
          },
        };
      });
    },
    [entry.position, setData],
  );

  const updateRim = React.useCallback(
    (patch: Partial<RimEntry>) => {
      setData((prev) => {
        const prevRim: RimEntry = prev.tires.rims?.[entry.position] ?? {};
        return {
          ...prev,
          tires: {
            ...prev.tires,
            rims: {
              ...(prev.tires.rims ?? {}),
              [entry.position]: { ...prevRim, ...patch },
            },
          },
        };
      });
    },
    [entry.position, setData],
  );

  const setImages = React.useCallback(
    (images: InspectedImage[]) => updateFinding({ images }),
    [updateFinding],
  );

  const appendNote = React.useCallback(
    (text: string) => {
      if (!text) return;
      const existing = current.notes ?? "";
      const sep =
        existing && !existing.endsWith(" ") && !existing.endsWith("\n")
          ? " "
          : "";
      updateFinding({ notes: `${existing}${sep}${text}`.trim() });
    },
    [current.notes, updateFinding],
  );

  return (
    <div
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
            <div className="truncate text-sm font-medium sm:text-[15px]">
              {entry.label}
            </div>
            {current.notes && !expanded && (
              <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                {current.notes}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={cn(
                "text-base font-bold tabular-nums sm:text-lg",
                depthTone(depth),
              )}
            >
              {depth}%
            </span>
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
                  <span>
                    {current.images.length}/{photosNeeded}
                  </span>
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
          <div className="space-y-4 border-t px-3 pb-3 pt-3 sm:px-4">
            <section className="space-y-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Neumático
              </h3>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Profundidad de banda
                </Label>
                <div className="mt-1 flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={depth}
                    onChange={(e) => updateDepth(Number(e.target.value))}
                    className="h-8 flex-1 accent-primary touch-none"
                  />
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={depth}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isNaN(n)) return;
                      updateDepth(Math.max(0, Math.min(100, n)));
                    }}
                    className="h-7 w-16 text-right"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              </div>
              <FindingSelector
                catalog={catalog}
                value={current.status}
                onChange={(v) => updateFinding({ status: v })}
              />
            </section>

            <section className="space-y-3 border-t pt-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Rin
              </h3>
              <div>
                <Label className="text-xs text-muted-foreground">Material</Label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {RIM_MATERIAL_OPTIONS.map((opt) => {
                    const active = rim.material === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          updateRim({
                            material: active ? undefined : opt.value,
                          })
                        }
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                          active
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : "border-border bg-card text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Origen</Label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {RIM_ORIGIN_OPTIONS.map((opt) => {
                    const active = rim.origin === opt.value;
                    const activeCls =
                      opt.tone === "success"
                        ? "border-success/60 bg-success/15 text-success"
                        : "border-warning/60 bg-warning/15 text-warning";
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          updateRim({ origin: active ? undefined : opt.value })
                        }
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                          active
                            ? activeCls
                            : "border-border bg-card text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <FindingSelector
                catalog={RIM_CATALOG}
                value={rim.status}
                onChange={(v) => updateRim({ status: v })}
              />
            </section>

            <section className="space-y-3 border-t pt-3">
              <div className="relative">
                <Textarea
                  placeholder="Observaciones del conjunto rueda (opcional)"
                  value={current.notes ?? ""}
                  onChange={(e) => updateFinding({ notes: e.target.value })}
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
            </section>
          </div>
        )}
    </div>
  );
}

function CompoundRow({
  entry,
}: {
  entry: Extract<WalkaroundEntry, { kind: "compound" }>;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 p-3 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-medium">{entry.label}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t p-3">
          {entry.compoundKey === "interior_delantera" ? (
            <InteriorDrilldown />
          ) : (
            <AccessoriesStep />
          )}
        </div>
      )}
    </div>
  );
}

function InteriorDrilldown() {
  const { data, setData } = useInspection();
  const group = COMFORT_SECTION.groups.find(
    (g) => g.id === "interior_delantera",
  );
  if (!group) return null;

  return (
    <div className="space-y-2">
      {group.items.map((item) => {
        const entry = data.comfort[item.id];
        return (
          <InspectionItemRow
            key={item.id}
            item={item}
            entry={entry}
            onChange={(next) =>
              setData((prev) => ({
                ...prev,
                comfort: { ...prev.comfort, [item.id]: next },
              }))
            }
          />
        );
      })}
    </div>
  );
}
