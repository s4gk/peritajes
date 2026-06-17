"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Info,
  Lock,
  MessageCircle,
  RefreshCw,
  Send,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { VoiceDictationButton } from "@/components/shared/voice-dictation-button";
import { useCurrentUser } from "@/components/panel/current-user";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api-client";
import { downloadInspectionPdf } from "@/lib/pdf-client";
import { analyze } from "@/lib/rules-engine";
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
  { value: "ESTÁNDAR", label: "ESTÁNDAR" },
  { value: "FUERA DE ESTÁNDAR", label: "FUERA DE ESTÁNDAR" },
  {
    value: "ASEGURABILIDAD SUJETA A POLÍTICAS",
    label: "ASEGURABILIDAD SUJETA A POLÍTICAS",
  },
];

export function SummaryStep() {
  const { data, setData, id: inspectionId, reportNumber } = useInspection();
  const currentUser = useCurrentUser();
  const report = React.useMemo(() => analyze(data), [data]);
  const toast = useToast();
  const [generating, setGenerating] = React.useState(false);
  // PDF "pendiente" significa que la finalización corrió OK pero el server no
  // pudo terminar de renderizar/persistir el PDF inline (Puppeteer o Gemini
  // fallaron). Lo seteamos cuando el sync-queue recibe pdfStatus="pending" en
  // la respuesta del PUT, y se limpia tras un download exitoso (que también
  // dispara un nuevo intento de render del lado del server).
  const [pdfPending, setPdfPending] = React.useState<{
    error: string | null;
  } | null>(null);
  const [retryingPdf, setRetryingPdf] = React.useState(false);
  // Modal de confirmación al finalizar. Reemplaza el window.confirm nativo
  // (feo y bloqueante) por un Dialog del design system.
  const [confirmFinalizeOpen, setConfirmFinalizeOpen] = React.useState(false);
  // Estado de entrega del PDF al cliente por WhatsApp (post-finalización).
  // Se pollea cada 3s desde /api/inspections/[id]/wa-status mientras el
  // peritaje esté finalizado, para que el perito vea en vivo si el cliente
  // recibió y pueda reenviar si dice que no le llegó.
  type WaEvent = {
    id: string;
    at: string;
    type: string;
    phone: string;
    status: "sent" | "failed" | "dedup";
    error?: string;
  };
  type WaStatus = {
    socket: { status: string; phone: string | null; queueSize: number };
    events: WaEvent[];
  };
  const [waStatus, setWaStatus] = React.useState<WaStatus | null>(null);
  const [resending, setResending] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    function onPdfPending(e: Event) {
      const ev = e as CustomEvent<{ inspectionId: string; error: string | null }>;
      if (ev.detail.inspectionId !== inspectionId) return;
      setPdfPending({ error: ev.detail.error });
    }
    window.addEventListener("perito:pdf-pending", onPdfPending);
    return () => window.removeEventListener("perito:pdf-pending", onPdfPending);
  }, [inspectionId]);

  // Polling del estado de entrega por WhatsApp. Solo se ejecuta cuando el
  // peritaje está finalizado y tiene teléfono del propietario cargado — sin
  // esos dos requisitos no hay envío que verificar. Cadencia 3s mientras
  // haya algo en la cola; cuando todo está enviado bajamos a 15s para no
  // martillar el server.
  React.useEffect(() => {
    if (data.status !== "completed") return;
    if (!data.vehicle.ownerPhone?.trim()) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await apiFetch(
          `/api/inspections/${encodeURIComponent(inspectionId)}/wa-status`,
          { credentials: "same-origin" },
        );
        if (res.ok && !cancelled) {
          const data = (await res.json()) as WaStatus;
          setWaStatus(data);
          const stillPending =
            data.socket.queueSize > 0 ||
            data.events.length === 0 ||
            data.events.some((e) => e.status === "failed");
          const delay = stillPending ? 3_000 : 15_000;
          if (!cancelled) timeout = setTimeout(tick, delay);
        } else if (!cancelled) {
          timeout = setTimeout(tick, 10_000);
        }
      } catch {
        if (!cancelled) timeout = setTimeout(tick, 10_000);
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [data.status, data.vehicle.ownerPhone, inspectionId]);

  async function resendPdfToClient() {
    setResending(true);
    try {
      const res = await apiFetch(
        `/api/inspections/${encodeURIComponent(inspectionId)}/resend-pdf`,
        { method: "POST", credentials: "same-origin" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          (body as { error?: string } | null)?.error ?? `${res.status}`,
        );
      }
      toast.show({
        title: "Reenvío encolado",
        description: "El PDF se está enviando de nuevo al cliente.",
        variant: "success",
      });
    } catch (err) {
      toast.show({
        title: "No se pudo reenviar",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "danger",
      });
    } finally {
      setResending(false);
    }
  }

  async function retryServerPdf() {
    setRetryingPdf(true);
    try {
      // GET /api/inspections/[id]/pdf reintenta ensureCompletedPdf si el
      // archivo no existe todavía. Si esto resuelve con 200, el render
      // funcionó y limpiamos el banner.
      const res = await apiFetch(
        `/api/inspections/${encodeURIComponent(inspectionId)}/pdf`,
        { credentials: "same-origin" },
      );
      if (res.ok) {
        // No descargamos el PDF — solo nos importa que se haya generado.
        // Bot drena el body para que el browser no mantenga el stream abierto.
        await res.blob();
        setPdfPending(null);
        toast.show({
          title: "PDF generado",
          description: "Ya quedó listo para enviar.",
          variant: "success",
        });
      } else {
        const body = await res.json().catch(() => null);
        toast.show({
          title: "No se pudo generar el PDF todavía",
          description:
            (body as { error?: string } | null)?.error ??
            `${res.status} ${res.statusText}`,
          variant: "warning",
        });
      }
    } catch (err) {
      toast.show({
        title: "Sin conexión",
        description:
          err instanceof Error ? err.message : "Reintenta en unos segundos.",
        variant: "warning",
      });
    } finally {
      setRetryingPdf(false);
    }
  }

  function updateConclusion(patch: Partial<typeof data.conclusion>) {
    setData((prev) => ({ ...prev, conclusion: { ...prev.conclusion, ...patch } }));
  }

  // Sincronizamos la firma del perfil hacia el peritaje mientras esté en
  // borrador. Si el perito actualiza su firma en /cuenta, la nueva versión se
  // aplica al peritaje en curso. Una vez finalizado, el peritaje queda
  // congelado con la firma que tenía al cerrar (data inmutable).
  React.useEffect(() => {
    if (data.status === "completed") return;
    const fromProfile = currentUser?.signatureDataUrl;
    if (!fromProfile) return;
    if (data.conclusion.inspectorSignature === fromProfile) return;
    updateConclusion({ inspectorSignature: fromProfile });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.signatureDataUrl, data.status, data.conclusion.inspectorSignature]);

  // Previsualización del PDF antes de finalizar. Sale con marca de agua
  // "PREVISUALIZACIÓN" y sin QR/consecutivo oficial, así que no se puede
  // confundir con el documento entregable. Disponible para todos los roles.
  async function generatePreviewPdf() {
    setGenerating(true);
    try {
      await downloadInspectionPdf(data, "detailed", inspectionId, {
        preview: true,
      });
      toast.show({
        title: "Previsualización generada",
        description: "Borrador con marca de agua. No es el documento oficial.",
        variant: "success",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      toast.show({
        title: "No se pudo generar la previsualización",
        description: message,
        variant: "danger",
      });
    } finally {
      setGenerating(false);
    }
  }

  // Descarga del PDF oficial post-finalización. Pega directo al endpoint
  // stored (no re-renderea — bytes exactos del documento entregable, con su
  // sha256 registrado). Disponible para todos los roles una vez el peritaje
  // está cerrado.
  async function downloadOfficialPdf() {
    setGenerating(true);
    try {
      const res = await apiFetch(
        `/api/inspections/${encodeURIComponent(inspectionId)}/pdf`,
        { credentials: "same-origin" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          (body as { error?: string } | null)?.error ?? `${res.status}`,
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const plate = (data.vehicle.plate || "inspeccion").replace(
        /[^A-Z0-9]/gi,
        "",
      );
      a.download = `peritaje-${plate}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.show({ title: "PDF descargado", variant: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      toast.show({
        title: "No se pudo descargar el PDF",
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
    if (!data.conclusion.clientSignature) {
      toast.show({
        title: "Falta la firma del cliente",
        description: "Captura la firma del cliente (QR o en pantalla) antes de cerrar el peritaje.",
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
    // Teléfono del cliente OBLIGATORIO para finalizar: la política dice que el
    // PDF se entrega sí o sí al cerrar, así que sin número de celular no hay
    // por dónde mandarlo. Validamos formato colombiano: 10 dígitos empezando
    // en 3, opcionalmente con prefijo +57/57.
    const phoneRaw = data.vehicle.ownerPhone?.trim() ?? "";
    const phoneDigits = phoneRaw.replace(/\D/g, "");
    const phoneValid =
      (phoneDigits.length === 10 && phoneDigits.startsWith("3")) ||
      (phoneDigits.length === 12 && phoneDigits.startsWith("573"));
    if (!phoneValid) {
      toast.show({
        title: phoneRaw ? "Teléfono del cliente inválido" : "Falta el teléfono del cliente",
        description: phoneRaw
          ? `"${phoneRaw}" no es un celular colombiano válido. Debe tener 10 dígitos y empezar por 3 (ej: 3138807390). Corrígelo en el paso "Vehículo / Propietario".`
          : "Capturá el celular del cliente (10 dígitos, empieza por 3) en el paso Vehículo. Sin teléfono no se puede entregar el PDF.",
        variant: "warning",
      });
      return;
    }
    // Validaciones OK → abrimos el modal de confirmación. La acción real corre
    // en confirmFinalize() al pulsar el botón del modal.
    setConfirmFinalizeOpen(true);
  }

  function confirmFinalize() {
    setConfirmFinalizeOpen(false);
    setData((prev) => ({
      ...prev,
      status: "completed",
      completedAt: new Date().toISOString(),
    }));
    toast.show({
      title: "Peritaje finalizado",
      description: data.vehicle.ownerPhone
        ? "Cerrado en solo lectura. Enviando el PDF al cliente por WhatsApp."
        : "Cerrado en solo lectura. El cliente no tiene teléfono cargado, descárgalo y envíalo manualmente.",
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

      {pdfPending && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">PDF aún no disponible</div>
              <div className="text-xs text-warning/90">
                El peritaje quedó cerrado, pero el render del PDF falló. El
                cliente lo recibirá apenas se regenere — puedes reintentar
                ahora.
                {pdfPending.error ? (
                  <span className="mt-1 block font-mono text-[10px] opacity-70">
                    {pdfPending.error}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={retryServerPdf}
            disabled={retryingPdf}
            className="self-start sm:self-auto"
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${retryingPdf ? "animate-spin" : ""}`}
            />
            {retryingPdf ? "Reintentando…" : "Reintentar"}
          </Button>
        </div>
      )}

      {data.status === "completed" && data.vehicle.ownerPhone?.trim() && (
        <WaDeliveryStatus
          status={waStatus}
          ownerPhone={data.vehicle.ownerPhone}
          ownerName={data.vehicle.owner ?? ""}
          onResend={resendPdfToClient}
          resending={resending}
        />
      )}

      <VerifikMismatchBanner vehicle={data.vehicle} verifik={data.verifik} compact />

      <Card>
        <CardHeader>
          <CardTitle>Resumen ejecutivo</CardTitle>
          <CardDescription>
            Análisis automatizado con base en los hallazgos capturados.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border bg-muted/40 p-4">
            <div className="text-lg font-semibold">{report.headline}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {report.conditionSummary}
            </div>
          </div>

          <FindingsTable
            rows={[
              {
                label: "Repintes",
                value: report.counters.repainted,
                severity: "warning",
              },
              {
                label: "Reparaciones",
                value: report.counters.repaired,
                severity: "warning",
              },
              {
                label: "Mal reparados",
                value: report.counters.poorlyRepaired,
                severity: "danger",
              },
              {
                label: "Daño estructural",
                value: report.counters.structuralHits,
                severity: "danger",
              },
              {
                label: "Fugas críticas",
                value: report.counters.criticalLeaks,
                severity: "danger",
              },
              {
                label: "Fallos mecánicos",
                value: report.counters.mechanicalBad,
                severity: "warning",
              },
              {
                label: "Frenos",
                value: report.counters.brakingIssues,
                severity: "danger",
              },
            ]}
          />

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
                {report.findings.map((f, i) => {
                  // Tinte sutil del mismo color del nivel: borde más marcado y
                  // fondo al 5-8% del color. Sin esto las filas se sentían
                  // planas y todas iguales aunque la severidad fuera distinta.
                  const toneClasses =
                    f.level === "critical"
                      ? "border-danger/30 bg-danger/5"
                      : f.level === "warning"
                        ? "border-warning/30 bg-warning/5"
                        : "border-border bg-muted/30";
                  return (
                    <li
                      key={i}
                      className={`flex items-start gap-3 rounded-md border p-3 ${toneClasses}`}
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
                  );
                })}
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
          <CardTitle>Firma del cliente</CardTitle>
          <CardDescription>
            La firma del perito se toma automáticamente del sistema. El cliente
            firma desde esta pantalla o escanea el QR para firmar en su celular.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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
          {data.status !== "completed" && !data.conclusion.clientSignature && (
            <RemoteSignaturePanel
              inspectionId={inspectionId}
              ownerPhone={data.vehicle.ownerPhone ?? ""}
              onSignatureReceived={(signature) =>
                updateConclusion({ clientSignature: signature })
              }
            />
          )}
        </CardContent>
      </Card>

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
        {/* Botón de descarga oficial: aparece SOLO cuando el peritaje está
            finalizado. Antes de finalizar, no se ofrece descarga al perito
            común — la única vía para entregar el PDF al cliente es cerrar el
            peritaje (que dispara el envío automático por WhatsApp). El admin
            (Vestel) mantiene el preview de borrador por debajo. */}
        {data.status === "completed" && (
          <Button
            type="button"
            onClick={downloadOfficialPdf}
            disabled={generating}
            size="lg"
            variant="outline"
          >
            {generating ? (
              <>
                <FileText className="mr-2 h-4 w-4 animate-pulse" />
                Descargando...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Descargar PDF
              </>
            )}
          </Button>
        )}
        {data.status !== "completed" && (
          <Button
            type="button"
            onClick={generatePreviewPdf}
            disabled={generating}
            size="lg"
            variant="outline"
            title="Ver el PDF antes de finalizar (sale con marca de agua de previsualización)"
          >
            {generating ? (
              <>
                <FileText className="mr-2 h-4 w-4 animate-pulse" />
                Generando...
              </>
            ) : (
              <>
                <Eye className="mr-2 h-4 w-4" />
                Previsualizar PDF
              </>
            )}
          </Button>
        )}
        {data.status !== "completed" && (
          <Button onClick={finalize} size="lg" variant="success">
            <Lock className="mr-2 h-4 w-4" />
            Finalizar peritaje
          </Button>
        )}
      </div>

      <Dialog open={confirmFinalizeOpen} onOpenChange={setConfirmFinalizeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-success" />
              Finalizar peritaje
            </DialogTitle>
            <DialogDescription>
              El peritaje quedará bloqueado en modo solo lectura y se asignará
              el consecutivo oficial. Si tienes cargado el teléfono del cliente,
              el PDF se le envía automáticamente por WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            ¿Seguro que quieres cerrarlo? Si necesitas corregir algo después, un
            administrador puede reabrirlo.
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmFinalizeOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="success"
              onClick={confirmFinalize}
            >
              <Lock className="mr-2 h-4 w-4" />
              Sí, finalizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Tabla del resumen ejecutivo. Reemplaza las 7 cajas tipo "Metric" sueltas por
 * una vista compacta tipo informe técnico: categoría, cantidad y un dot
 * indicator de estado (● Detectado / ○ Sin hallazgos). El color del dot va
 * según la severidad declarada por categoría — por ejemplo "Frenos" siempre
 * va en rojo cuando hay hallazgos, "Repintes" en ámbar.
 */
type FindingRow = {
  label: string;
  value: number;
  severity: "warning" | "danger";
};

function FindingsTable({ rows }: { rows: FindingRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Categoría</th>
            <th className="px-4 py-2 text-center font-medium">Cantidad</th>
            <th className="px-4 py-2 text-right font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const detected = r.value > 0;
            const dotClass = !detected
              ? "bg-muted-foreground/40"
              : r.severity === "danger"
                ? "bg-danger"
                : "bg-warning";
            const statusText = detected ? "Detectado" : "Sin hallazgos";
            const statusTextClass = !detected
              ? "text-muted-foreground"
              : r.severity === "danger"
                ? "text-danger"
                : "text-warning";
            return (
              <tr
                key={r.label}
                className={i % 2 === 0 ? "bg-card" : "bg-muted/20"}
              >
                <td className="px-4 py-2.5 font-medium">{r.label}</td>
                <td className="px-4 py-2.5 text-center tabular-nums">
                  {r.value}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <span
                    className={`inline-flex items-center gap-2 font-medium ${statusTextClass}`}
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${dotClass}`}
                      aria-hidden
                    />
                    {statusText}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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

/**
 * Card que muestra el estado del envío del PDF al cliente por WhatsApp y
 * permite reenviar manualmente. Lee del polling de /wa-status y elige el
 * mensaje según los eventos disponibles + el socket de la org.
 *
 * Reglas de estado (en orden de prioridad):
 *  - Si el socket está desconectado → "WhatsApp del negocio no está conectado"
 *  - Si hay un evento `sent` reciente → "PDF entregado a +57... a las HH:MM"
 *  - Si hay un evento `failed` → "Falló el envío (motivo)" + botón Reenviar
 *  - Si la cola tiene mensajes pendientes o no hay eventos todavía → "Encolado..."
 */
/**
 * Panel para pedir firma REMOTA al cliente (link por WhatsApp, TTL 72h).
 * Aparece dentro del step de firma cuando el cliente NO está presente y el
 * perito necesita seguir adelante. Tres estados visibles:
 *
 *  - Sin sesión: botón "Pedir firma por WhatsApp" → POST crea sesión y manda
 *    link al cliente.
 *  - Esperando: contador "Link enviado hace X · expira en Y" + opción de
 *    re-enviar (`force: true`).
 *  - Firmado: jala la firma del server al data del peritaje vía
 *    `onSignatureReceived` — el wizard la persiste como si el perito la
 *    hubiera tomado en presencial.
 *
 * Polling cada 5s mientras esperamos firma; cuando llega, baja a nada y
 * dispara el callback una sola vez (ref `appliedOnce`).
 */
function RemoteSignaturePanel({
  inspectionId,
  ownerPhone,
  onSignatureReceived,
}: {
  inspectionId: string;
  ownerPhone: string;
  onSignatureReceived: (signatureDataUrl: string) => void;
}) {
  const toast = useToast();
  type RemoteState = {
    hasSession: boolean;
    token: string | null;
    expiresAt: number | null;
    signedAt: number | null;
    signature: string | null;
  };
  const [state, setState] = React.useState<RemoteState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const appliedOnceRef = React.useRef(false);

  const phoneClean = ownerPhone.replace(/\D/g, "");
  const phoneValid =
    (phoneClean.length === 10 && phoneClean.startsWith("3")) ||
    (phoneClean.length === 12 && phoneClean.startsWith("573"));

  async function fetchStatus() {
    try {
      const res = await apiFetch(
        `/api/inspections/${encodeURIComponent(inspectionId)}/request-remote-signature`,
        { credentials: "same-origin" },
      );
      if (res.ok) {
        const json = (await res.json()) as RemoteState;
        setState(json);
        // Auto-aplicación: si el cliente firmó y aún no aplicamos la firma al
        // data del peritaje, lo hacemos una sola vez. El perito no tiene que
        // apretar nada — entra al wizard, ve "firmado" y sigue al finalizar.
        if (
          json.signature &&
          json.signedAt &&
          !appliedOnceRef.current
        ) {
          appliedOnceRef.current = true;
          onSignatureReceived(json.signature);
          toast.show({
            title: "Firma del cliente recibida",
            description:
              "Ya quedó aplicada al peritaje. Puedes proceder a finalizar.",
            variant: "success",
          });
        }
      }
    } catch {
      /* polling silencioso */
    }
  }

  React.useEffect(() => {
    void fetchStatus();
    const t = window.setInterval(fetchStatus, 5_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectionId]);

  async function request(force: boolean) {
    if (!phoneValid) {
      toast.show({
        title: "Teléfono del cliente inválido",
        description:
          "Debe tener 10 dígitos colombianos (ej: 3138807390). Cárgalo en el paso Vehículo antes de pedir firma remota.",
        variant: "warning",
      });
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(
        `/api/inspections/${encodeURIComponent(inspectionId)}/request-remote-signature`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ force }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show({
          title: "No se pudo pedir la firma",
          description: (json as { error?: string })?.error ?? `${res.status}`,
          variant: "danger",
        });
        return;
      }
      toast.show({
        title: force
          ? "Link reenviado"
          : (json as { reused?: boolean })?.reused
            ? "Link ya enviado"
            : "Link enviado al cliente",
        description: `WhatsApp a ${ownerPhone}. Vence en 72 horas.`,
        variant: "success",
      });
      await fetchStatus();
    } finally {
      setBusy(false);
    }
  }

  // Si no podemos mandar (sin teléfono) ni vale la pena mostrar el panel.
  if (!ownerPhone.trim()) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">¿Cliente no presente?</strong>{" "}
        Carga el teléfono del cliente en el paso <em>Vehículo</em> para
        habilitar el envío de un link de firma remota por WhatsApp.
      </div>
    );
  }

  const hoursLeft =
    state?.expiresAt && !state.signedAt
      ? Math.max(0, Math.round((state.expiresAt - Date.now()) / 3_600_000))
      : null;
  const waiting = state?.hasSession && !state?.signedAt;
  const signed = state?.hasSession && state?.signedAt;

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
      <div className="flex items-start gap-2">
        <Send className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">
            ¿El cliente no está presente?
          </div>
          {!state || (!waiting && !signed) ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Envía un link por WhatsApp al cliente y deja que firme desde su
              casa. El link es válido por 72 horas.
            </p>
          ) : waiting ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Esperando firma del cliente. Link válido por{" "}
              <strong className="text-foreground">
                {hoursLeft} {hoursLeft === 1 ? "hora" : "horas"}
              </strong>{" "}
              más. Te avisamos por WhatsApp apenas firme.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-success">
              ✓ El cliente firmó. La firma ya quedó aplicada al peritaje.
            </p>
          )}
          {!signed && (
            <div className="mt-2 flex flex-wrap gap-2">
              {!waiting ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => request(false)}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2Spin />
                  ) : (
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Enviar link por WhatsApp
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => request(true)}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2Spin />
                  ) : (
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Reenviar link
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Loader2Spin() {
  return (
    <span className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
  );
}

function WaDeliveryStatus({
  status,
  ownerPhone,
  ownerName,
  onResend,
  resending,
}: {
  status: {
    socket: { status: string; phone: string | null; queueSize: number };
    events: {
      id: string;
      at: string;
      type: string;
      phone: string;
      status: "sent" | "failed" | "dedup";
      error?: string;
    }[];
  } | null;
  ownerPhone: string;
  ownerName: string;
  onResend: () => void | Promise<void>;
  resending: boolean;
}) {
  // Solo nos importan los eventos del PDF (client-pdf). Los demás (sign-link)
  // ya pasaron antes de finalizar; mostrarlos acá confunde.
  const pdfEvents = (status?.events ?? []).filter((e) => e.type === "client-pdf");
  const latest = pdfEvents[0]; // más reciente (orden DESC desde el endpoint)
  const sentEvent = pdfEvents.find((e) => e.status === "sent");
  const socketStatus = status?.socket.status ?? "disconnected";

  let tone: "info" | "success" | "warning" | "danger" = "info";
  let title = "Enviando PDF al cliente por WhatsApp…";
  let detail = `Destinatario: ${ownerPhone}${ownerName ? ` · ${ownerName}` : ""}`;
  let showResend = false;
  let resendLabel = "Reenviar";

  if (socketStatus !== "connected" && !sentEvent) {
    tone = "warning";
    title = "WhatsApp del negocio no está conectado";
    detail =
      "El PDF se mandará apenas reconectes en /whatsapp. Mientras tanto, el envío queda en cola.";
  } else if (sentEvent) {
    tone = "success";
    const when = new Date(sentEvent.at).toLocaleString("es-CO", {
      timeZone: "America/Bogota",
      hour: "numeric",
      minute: "2-digit",
      day: "numeric",
      month: "short",
      hour12: true,
    });
    title = "PDF entregado al cliente por WhatsApp";
    detail = `+${sentEvent.phone.replace(/^\+/, "")} · ${when}`;
    showResend = true;
    resendLabel = "Reenviar igual";
  } else if (latest?.status === "failed") {
    tone = "danger";
    title = "El envío falló";
    detail = latest.error
      ? `Motivo: ${latest.error}. Puedes reintentar abajo.`
      : "Reintenta el envío con el botón.";
    showResend = true;
  } else {
    tone = "info";
    title = "Enviando PDF al cliente por WhatsApp…";
    detail = `Destinatario: ${ownerPhone}${ownerName ? ` · ${ownerName}` : ""}. Esto puede tardar unos segundos por la cola anti-spam.`;
  }

  const wrapper =
    tone === "success"
      ? "border-success/40 bg-success/10"
      : tone === "warning"
        ? "border-warning/40 bg-warning/10"
        : tone === "danger"
          ? "border-danger/40 bg-danger/10"
          : "border-muted bg-muted/30";

  const Icon =
    tone === "success" ? CheckCircle2 : tone === "danger" ? AlertTriangle : MessageCircle;
  const iconColor =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-muted-foreground";

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${wrapper}`}
    >
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} />
        <div>
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{detail}</div>
          {pdfEvents.length > 1 && (
            <div className="mt-1 text-[11px] text-muted-foreground/80">
              Envíos previos: {pdfEvents.length}
            </div>
          )}
        </div>
      </div>
      {showResend && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onResend}
          disabled={resending}
          className="self-start sm:self-auto"
        >
          {resending ? (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="mr-1.5 h-3.5 w-3.5" />
          )}
          {resending ? "Reenviando…" : resendLabel}
        </Button>
      )}
    </div>
  );
}
