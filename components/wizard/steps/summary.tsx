"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Info,
  Link2,
  Lock,
  RefreshCw,
  Share2,
  Trash2,
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
import { useCurrentUser } from "@/components/panel/current-user";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api-client";
import { downloadInspectionPdf } from "@/lib/pdf-client";
import { analyze, riskTone } from "@/lib/rules-engine";
import {
  countMandatorySlotsFilled,
  missingMandatorySlots,
  MIN_REQUIRED_PHOTOS,
} from "@/lib/photo-count";

import { useInspection } from "../inspection-context";
import { VerifikMismatchBanner } from "../verifik-mismatch-banner";

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
  const { data, setData, id: inspectionId, reportNumber } = useInspection();
  const currentUser = useCurrentUser();
  const report = React.useMemo(() => analyze(data), [data]);
  const tone = riskTone(report.level);
  const toast = useToast();
  const [generating, setGenerating] = React.useState(false);

  function updateConclusion(patch: Partial<typeof data.conclusion>) {
    setData((prev) => ({ ...prev, conclusion: { ...prev.conclusion, ...patch } }));
  }

  // Si el peritaje no tiene firma del perito pero el usuario sí guardó una en
  // perfil, la inyectamos como default. Se hace una sola vez por peritaje —
  // si después el perito la borra explícitamente, no la volvemos a meter.
  const seededSignatureRef = React.useRef(false);
  React.useEffect(() => {
    if (seededSignatureRef.current) return;
    if (data.status === "completed") return;
    if (data.conclusion.inspectorSignature) {
      seededSignatureRef.current = true;
      return;
    }
    const fromProfile = currentUser?.signatureDataUrl;
    if (!fromProfile) return;
    seededSignatureRef.current = true;
    updateConclusion({ inspectorSignature: fromProfile });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.signatureDataUrl, data.status]);

  async function generatePdf(mode: "executive" | "detailed") {
    setGenerating(true);
    try {
      await downloadInspectionPdf(data, mode, inspectionId);
      toast.show({
        title: `PDF ${mode === "executive" ? "ejecutivo" : "detallado"} generado`,
        variant: "success",
      });
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

  function finalize() {
    if (!data.conclusion.generalCondition) {
      toast.show({
        title: "Falta la condición general",
        description: "Selecciona la condición general antes de finalizar.",
        variant: "warning",
      });
      return;
    }
    if (!data.conclusion.inspectorSignature) {
      toast.show({
        title: "Falta tu firma",
        description: "El perito responsable debe firmar antes de cerrar el peritaje.",
        variant: "warning",
      });
      return;
    }
    if (!data.conclusion.clientSignature) {
      toast.show({
        title: "Falta la firma del cliente",
        description: "Capturá la firma del cliente (QR o en pantalla) antes de cerrar el peritaje.",
        variant: "warning",
      });
      return;
    }
    const filled = countMandatorySlotsFilled(data);
    if (filled < MIN_REQUIRED_PHOTOS) {
      const missing = missingMandatorySlots(data);
      toast.show({
        title: `Faltan fotos obligatorias (${filled}/${MIN_REQUIRED_PHOTOS})`,
        description: `Pendientes: ${missing.join(", ")}.`,
        variant: "warning",
      });
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(
      "¿Finalizar el peritaje? Quedará bloqueado en modo solo lectura. Podrás reabrirlo si necesitás corregir algo.",
    )) {
      return;
    }
    setData((prev) => ({
      ...prev,
      status: "completed",
      completedAt: new Date().toISOString(),
    }));
    toast.show({
      title: "Peritaje finalizado",
      description: "Quedó cerrado en solo lectura. Podés descargar el PDF cuando quieras.",
      variant: "success",
    });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="space-y-6">
      {reportNumber && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm">
          <Lock className="h-4 w-4 shrink-0 text-success" />
          <div className="flex-1">
            <span className="font-semibold text-success">Peritaje finalizado.</span>
            <span className="ml-1 text-muted-foreground">Consecutivo oficial:</span>
          </div>
          <code className="rounded border bg-background px-2 py-1 font-mono text-sm font-semibold tracking-wide">
            {reportNumber}
          </code>
        </div>
      )}

      <VerifikMismatchBanner vehicle={data.vehicle} verifik={data.verifik} compact />

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
            Las dos firmas son obligatorias para finalizar el peritaje y reemplazan
            cualquier firma genérica en el PDF.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SignaturePad
            label={data.vehicle.inspector ? `Firma de ${data.vehicle.inspector}` : "Firma del perito"}
            hint={
              data.vehicle.inspectorId
                ? `Identificación profesional: ${data.vehicle.inspectorId}`
                : "Firmá con el dedo o el lápiz óptico en el cuadro."
            }
            value={data.conclusion.inspectorSignature}
            onChange={(signature) => updateConclusion({ inspectorSignature: signature })}
          />
          <ClientSignatureCapture
            label={data.vehicle.owner ? `Firma de ${data.vehicle.owner}` : "Firma del cliente"}
            hint={
              data.vehicle.ownerDocument
                ? `Documento: ${data.vehicle.ownerDocument}`
                : "El cliente puede firmar en esta pantalla o escanear el QR para firmar desde su celular."
            }
            value={data.conclusion.clientSignature}
            onChange={(signature) => updateConclusion({ clientSignature: signature })}
            clientPhone={data.vehicle.ownerPhone}
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

      <ShareCard inspectionId={inspectionId} vehicle={data.vehicle} />

      {(() => {
        const filled = countMandatorySlotsFilled(data);
        const ok = filled >= MIN_REQUIRED_PHOTOS;
        const missing = ok ? [] : missingMandatorySlots(data);
        return (
          <div
            className={
              ok
                ? "rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success-foreground"
                : "rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
            }
          >
            <span className="font-semibold">
              Fotos obligatorias: {filled}/{MIN_REQUIRED_PHOTOS}
            </span>
            {!ok && (
              <span className="ml-2 text-muted-foreground">
                Faltan: {missing.join(", ")}.
              </span>
            )}
          </div>
        );
      })()}

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          onClick={() => generatePdf("detailed")}
          disabled={generating}
          size="lg"
          variant="outline"
        >
          {generating ? (
            <>
              <FileText className="mr-2 h-4 w-4 animate-pulse" />
              Generando...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              PDF detallado
            </>
          )}
        </Button>
        {data.status !== "completed" && (
          <Button onClick={finalize} size="lg" variant="success">
            <Lock className="mr-2 h-4 w-4" />
            Finalizar peritaje
          </Button>
        )}
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

type ShareTokenInfo = {
  token: string;
  url: string;
  expiresAt: string;
  accessCount: number;
  lastAccessedAt?: string | null;
};

function buildPublicUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

function buildWhatsAppMessage(opts: {
  ownerName: string;
  plate: string;
  make: string;
  model: string;
  url: string;
}): string {
  const greeting = opts.ownerName
    ? `Hola ${opts.ownerName.split(" ")[0]}`
    : "Hola";
  const vehicle = [opts.make, opts.model].filter(Boolean).join(" ").trim();
  const vehicleLabel = vehicle
    ? `${vehicle} de placa ${opts.plate || "—"}`
    : `placa ${opts.plate || "—"}`;
  return `${greeting}, te comparto el peritaje del vehículo ${vehicleLabel}: ${opts.url}`;
}

function ShareCard({
  inspectionId,
  vehicle,
}: {
  inspectionId: string;
  vehicle: { plate: string; make: string; model: string; owner: string; ownerPhone: string };
}) {
  const toast = useToast();
  const [info, setInfo] = React.useState<ShareTokenInfo | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/share?inspectionId=${encodeURIComponent(inspectionId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { token: string | null } & Partial<ShareTokenInfo>;
        if (cancelled) return;
        if (data.token) {
          setInfo({
            token: data.token,
            url: data.url ?? `/r/${data.token}`,
            expiresAt: data.expiresAt ?? "",
            accessCount: data.accessCount ?? 0,
            lastAccessedAt: data.lastAccessedAt ?? null,
          });
        }
      } catch {
        // No bloquea el flujo si la API está caída.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inspectionId]);

  async function createOrFetchLink(force = false) {
    setBusy(true);
    try {
      const res = await apiFetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inspectionId, force }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Error generando link");
      }
      const data = (await res.json()) as ShareTokenInfo;
      setInfo(data);
      toast.show({
        title: force ? "Nuevo enlace generado" : "Enlace listo",
        variant: "success",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      toast.show({ title: "No se pudo generar el enlace", description: message, variant: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!info) return;
    if (typeof window !== "undefined" && !window.confirm(
      "¿Revocar este enlace? El cliente ya no podrá abrirlo.",
    )) {
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(`/api/share/${encodeURIComponent(info.token)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      setInfo(null);
      toast.show({ title: "Enlace revocado", variant: "default" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      toast.show({ title: "No se pudo revocar", description: message, variant: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!info) return;
    const url = buildPublicUrl(info.url);
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ title: "Enlace copiado", variant: "success" });
    } catch {
      toast.show({ title: "No se pudo copiar", description: url, variant: "warning" });
    }
  }

  function shareWhatsApp() {
    if (!info) return;
    const url = buildPublicUrl(info.url);
    const message = buildWhatsAppMessage({
      ownerName: vehicle.owner ?? "",
      plate: vehicle.plate ?? "",
      make: vehicle.make ?? "",
      model: vehicle.model ?? "",
      url,
    });
    const phoneDigits = (vehicle.ownerPhone ?? "").replace(/\D/g, "");
    const wa = phoneDigits
      ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(wa, "_blank", "noopener,noreferrer");
  }

  const expiresText = info?.expiresAt
    ? new Date(info.expiresAt).toLocaleDateString("es-CO", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Share2 className="h-5 w-5 text-primary" />
          <CardTitle>Compartir con cliente</CardTitle>
        </div>
        <CardDescription>
          Generá un enlace público que abre el PDF del peritaje. El cliente no necesita iniciar sesión.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!loaded ? (
          <div className="text-sm text-muted-foreground">Cargando...</div>
        ) : info ? (
          <>
            <div className="rounded-lg border bg-muted/40 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" />
                Enlace público
              </div>
              <div className="mt-1 break-all font-mono text-sm">
                {buildPublicUrl(info.url)}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Vence el {expiresText}</span>
                <span>·</span>
                <span>
                  {info.accessCount} {info.accessCount === 1 ? "apertura" : "aperturas"}
                </span>
                {info.lastAccessedAt && (
                  <>
                    <span>·</span>
                    <span>
                      Última: {new Date(info.lastAccessedAt).toLocaleString("es-CO")}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={shareWhatsApp} disabled={busy}>
                <Share2 className="mr-2 h-4 w-4" />
                Enviar por WhatsApp
              </Button>
              <Button type="button" variant="outline" onClick={copyLink} disabled={busy}>
                <Copy className="mr-2 h-4 w-4" />
                Copiar enlace
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => createOrFetchLink(true)}
                disabled={busy}
                title="Genera un enlace nuevo y revoca el anterior implícitamente al expirar"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Regenerar
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={revoke}
                disabled={busy}
                className="text-danger hover:text-danger"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Revocar
              </Button>
            </div>
          </>
        ) : (
          <Button
            type="button"
            size="lg"
            onClick={() => createOrFetchLink(false)}
            disabled={busy}
          >
            <Link2 className="mr-2 h-4 w-4" />
            {busy ? "Generando..." : "Generar enlace para el cliente"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
