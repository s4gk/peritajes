"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Info,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ClientSignatureCapture } from "@/components/shared/client-signature-capture";
import { SignaturePad } from "@/components/shared/signature-pad";
import { VoiceDictationButton } from "@/components/shared/voice-dictation-button";
import { useToast } from "@/components/ui/toast";
import { analyze, riskTone } from "@/lib/rules-engine";

import { useInspection } from "../inspection-context";

function appendText(existing: string, added: string): string {
  if (!added) return existing;
  const sep = existing && !existing.endsWith(" ") && !existing.endsWith("\n") ? " " : "";
  return `${existing}${sep}${added}`.trim();
}

const CONDITION_OPTIONS = [
  { value: "mech_optimal", label: "Óptima" },
  { value: "mech_noise_light", label: "Aceptable con observaciones menores" },
  { value: "mech_play_in_tolerance", label: "Regular — requiere mantenimiento" },
  { value: "mech_no_response", label: "Deficiente — requiere intervención" },
];

export function SummaryStep() {
  const { data, setData } = useInspection();
  const report = React.useMemo(() => analyze(data), [data]);
  const tone = riskTone(report.level);
  const toast = useToast();
  const [generating, setGenerating] = React.useState(false);

  function updateConclusion(patch: Partial<typeof data.conclusion>) {
    setData((prev) => ({ ...prev, conclusion: { ...prev.conclusion, ...patch } }));
  }

  async function generatePdf() {
    setGenerating(true);
    try {
      const res = await fetch("/api/pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data, report }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Error al generar PDF");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const plate = (data.vehicle.plate || "inspeccion").replace(/[^A-Z0-9]/gi, "");
      a.download = `peritaje-${plate}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.show({ title: "PDF generado", variant: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      toast.show({
        title: "No se pudo generar el PDF",
        description: message,
        variant: "danger",
      });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Resumen ejecutivo</CardTitle>
              <CardDescription>
                Análisis automatizado con base en los hallazgos capturados.
              </CardDescription>
            </div>
            <Badge variant={tone} className="self-start text-sm">
              Riesgo{" "}
              {report.level === "low"
                ? "bajo"
                : report.level === "medium"
                  ? "medio"
                  : "alto"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border bg-muted/40 p-4">
            <div className="text-lg font-semibold">{report.headline}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {report.conditionSummary}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Repintados"
              value={report.counters.repainted}
              tone={report.counters.repainted > 0 ? "warning" : "neutral"}
            />
            <Metric
              label="Reparados"
              value={report.counters.repaired}
              tone={report.counters.repaired > 0 ? "warning" : "neutral"}
            />
            <Metric
              label="Mal reparados"
              value={report.counters.poorlyRepaired}
              tone={report.counters.poorlyRepaired > 0 ? "danger" : "neutral"}
            />
            <Metric
              label="Daño estructural"
              value={report.counters.structuralHits}
              tone={report.counters.structuralHits > 0 ? "danger" : "neutral"}
            />
            <Metric
              label="Fugas críticas"
              value={report.counters.criticalLeaks}
              tone={report.counters.criticalLeaks > 0 ? "danger" : "neutral"}
            />
            <Metric
              label="Mecánica falla"
              value={report.counters.mechanicalBad}
              tone={report.counters.mechanicalBad > 0 ? "warning" : "neutral"}
            />
            <Metric
              label="Frenos"
              value={report.counters.brakingIssues}
              tone={report.counters.brakingIssues > 0 ? "danger" : "neutral"}
            />
            <Metric label="Puntaje de riesgo" value={report.score} tone={tone} />
          </div>

          <Separator />

          <div>
            <h3 className="mb-3 text-sm font-semibold">Hallazgos</h3>
            {report.findings.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" />
                Sin hallazgos relevantes.
              </div>
            ) : (
              <ul className="space-y-2">
                {report.findings.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 rounded-md border bg-card p-3"
                  >
                    <FindingIcon level={f.level} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{f.item}</span>
                        <Badge
                          variant={
                            f.level === "critical"
                              ? "danger"
                              : f.level === "warning"
                                ? "warning"
                                : "neutral"
                          }
                          className="text-[10px]"
                        >
                          {f.section}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">{f.message}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conclusión técnica</CardTitle>
          <CardDescription>
            Observaciones y recomendación final del perito.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Condición general</Label>
            <Select
              value={data.conclusion.generalCondition || undefined}
              onValueChange={(v) => updateConclusion({ generalCondition: v })}
            >
              <SelectTrigger className="max-w-sm">
                <SelectValue placeholder="Seleccione" />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="observations">Observaciones generales</Label>
            <div className="relative">
              <Textarea
                id="observations"
                rows={4}
                value={data.conclusion.observations}
                onChange={(e) => updateConclusion({ observations: e.target.value })}
                placeholder="Resumen profesional del estado general, hallazgos relevantes y contexto."
                className="pr-11"
              />
              <div className="absolute right-1.5 top-1.5">
                <VoiceDictationButton
                  onTranscript={(t) =>
                    updateConclusion({
                      observations: appendText(data.conclusion.observations ?? "", t),
                    })
                  }
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="recommendation">Recomendación</Label>
            <div className="relative">
              <Textarea
                id="recommendation"
                rows={3}
                value={data.conclusion.recommendation}
                onChange={(e) => updateConclusion({ recommendation: e.target.value })}
                placeholder="Recomendación para el cliente: apto, apto con reservas, requiere intervención, no apto..."
                className="pr-11"
              />
              <div className="absolute right-1.5 top-1.5">
                <VoiceDictationButton
                  onTranscript={(t) =>
                    updateConclusion({
                      recommendation: appendText(data.conclusion.recommendation ?? "", t),
                    })
                  }
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Firmas</CardTitle>
          <CardDescription>
            Firmas en pantalla del perito y del cliente (se embeberán en el PDF).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <SignaturePad
            label="Firma del perito"
            hint={data.vehicle.inspector || undefined}
            value={data.conclusion.inspectorSignature}
            onChange={(v) => updateConclusion({ inspectorSignature: v })}
          />
          <ClientSignatureCapture
            label="Firma del cliente"
            hint={data.vehicle.owner || undefined}
            value={data.conclusion.clientSignature}
            onChange={(v) => updateConclusion({ clientSignature: v })}
            buildContext={() => ({
              plate: data.vehicle.plate,
              make: data.vehicle.make,
              model: data.vehicle.model,
              year: data.vehicle.year,
              inspector: data.vehicle.inspector,
              owner: data.vehicle.owner,
            })}
          />
        </CardContent>
      </Card>

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
        <Button onClick={generatePdf} disabled={generating} size="lg">
          {generating ? (
            <>
              <FileText className="mr-2 h-4 w-4 animate-pulse" />
              Generando...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Generar informe PDF
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "danger" | "neutral";
}) {
  const toneClasses =
    tone === "danger"
      ? "border-danger/40 bg-danger/10 text-danger"
      : tone === "warning"
        ? "border-warning/40 bg-warning/10 text-warning"
        : tone === "success"
          ? "border-success/40 bg-success/10 text-success"
          : "border-border bg-muted text-muted-foreground";
  return (
    <div className={`rounded-lg border p-3 ${toneClasses}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function FindingIcon({ level }: { level: "info" | "warning" | "critical" }) {
  if (level === "critical")
    return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />;
  if (level === "warning")
    return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />;
  return <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />;
}
