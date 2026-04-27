"use client";

import * as React from "react";
import {
  CheckCircle2,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SignaturePad } from "@/components/shared/signature-pad";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type SessionContext = {
  plate?: string;
  make?: string;
  model?: string;
  year?: string;
  inspector?: string;
  owner?: string;
};

type Props = {
  label: string;
  hint?: string;
  value: string | undefined;
  onChange: (dataUrl: string | undefined) => void;
  buildContext: () => SessionContext;
};

const POLL_INTERVAL_MS = 2500;

export function ClientSignatureCapture({
  label,
  hint,
  value,
  onChange,
  buildContext,
}: Props) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"idle" | "qr" | "manual">("idle");
  const [token, setToken] = React.useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [expiresAt, setExpiresAt] = React.useState<number | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [pollState, setPollState] = React.useState<"waiting" | "received">("waiting");
  const toast = useToast();

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      // no-op — the poller is scoped to dialog open
    };
  }, []);

  async function startQrFlow() {
    if (typeof window === "undefined") return;
    setDialogOpen(true);
    setMode("qr");
    setCreating(true);
    setPollState("waiting");
    setToken(null);
    setQrDataUrl(null);
    try {
      const res = await fetch("/api/sign/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: buildContext() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { token: string; expiresAt: number };
      const url = `${window.location.origin}/sign/${data.token}`;
      // Lazy-load qrcode on click so the package never runs server-side during SSR.
      // (Its main entry pulls in Node-only modules like fs/pngjs.)
      const QRCode = (await import("qrcode")).default;
      const qr = await QRCode.toDataURL(url, {
        errorCorrectionLevel: "M",
        width: 512,
        margin: 1,
      });
      setToken(data.token);
      setQrDataUrl(qr);
      setExpiresAt(data.expiresAt);
    } catch {
      toast.show({
        title: "No se pudo iniciar la firma por QR",
        description: "Inténtalo nuevamente o usa firma manual.",
        variant: "danger",
      });
      setDialogOpen(false);
      setMode("idle");
    } finally {
      setCreating(false);
    }
  }

  // Polling while a QR token is active and no signature received
  React.useEffect(() => {
    if (!dialogOpen || mode !== "qr" || !token || pollState === "received") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/sign/session/${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (res.status === 404) {
          setPollState("waiting");
          toast.show({
            title: "La sesión de firma expiró",
            description: "Genera un nuevo QR para intentar de nuevo.",
            variant: "warning",
          });
          setMode("idle");
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { signature: string | null };
        if (data.signature) {
          setPollState("received");
          onChange(data.signature);
          toast.show({
            title: "Firma recibida del cliente",
            variant: "success",
          });
        }
      } catch {
        // network hiccup — next tick will retry
      }
    };
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    // Kick an immediate check so we don't wait a full interval
    tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [dialogOpen, mode, token, pollState, onChange, toast]);

  const signUrl =
    typeof window !== "undefined" && token
      ? `${window.location.origin}/sign/${token}`
      : "";

  return (
    <div className="space-y-3">
      {value ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Smartphone className="h-4 w-4 text-muted-foreground" />
            {label}
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-success/40 bg-success/5 p-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-success">
                Firma del cliente registrada
              </div>
              {hint && (
                <div className="text-xs text-muted-foreground">{hint}</div>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={value}
                alt="Firma del cliente"
                className="mt-2 h-20 w-full rounded border bg-white object-contain"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange(undefined)}
              className="gap-1"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Capturar de nuevo
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">{label}</div>
          </div>
          {mode === "manual" ? (
            <SignaturePad
              label="Firma del cliente"
              hint={hint}
              value={value}
              onChange={onChange}
            />
          ) : (
            <div className="rounded-lg border border-dashed bg-muted/40 p-4 text-center">
              <div className="mx-auto mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Smartphone className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-medium">Firma remota por QR</p>
              <p className="mt-1 text-xs text-muted-foreground">
                El cliente escanea el código con su celular y firma en su propia pantalla.
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={startQrFlow}
              size="sm"
              className="gap-1.5"
            >
              <QrCode className="h-4 w-4" />
              Firmar con QR
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMode(mode === "manual" ? "idle" : "manual")}
              className="gap-1.5"
            >
              {mode === "manual" ? "Ocultar firma manual" : "Firmar en esta pantalla"}
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setMode(value ? "idle" : "idle");
            setToken(null);
            setQrDataUrl(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Firma por QR</DialogTitle>
            <DialogDescription>
              El cliente debe escanear este código con la cámara de su celular.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {creating || !qrDataUrl ? (
              <div className="flex aspect-square w-full items-center justify-center rounded-lg border bg-muted">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt="Código QR para firmar"
                  className={cn(
                    "aspect-square w-full rounded-lg border bg-white p-3",
                    pollState === "received" && "opacity-30",
                  )}
                />
                {pollState === "received" && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex items-center gap-2 rounded-full bg-success px-4 py-2 text-success-foreground shadow">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="text-sm font-semibold">Firma recibida</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {signUrl && (
              <div className="rounded-md bg-muted/60 p-2 text-center text-[11px]">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Enlace directo
                </div>
                <div className="mt-0.5 break-all font-mono text-[11px]">
                  {signUrl}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2
                className={cn(
                  "h-3 w-3 animate-spin",
                  pollState === "received" && "hidden",
                )}
              />
              {pollState === "received"
                ? "Firma aplicada al informe."
                : "Esperando firma del cliente..."}
              {expiresAt && pollState !== "received" && (
                <span className="ml-auto">
                  expira {formatRelativeFuture(expiresAt)}
                </span>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(false)}
              >
                {pollState === "received" ? "Cerrar" : "Cancelar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatRelativeFuture(ts: number): string {
  const ms = ts - Date.now();
  if (ms <= 0) return "pronto";
  const m = Math.floor(ms / 60_000);
  if (m >= 1) return `en ${m} min`;
  const s = Math.floor(ms / 1000);
  return `en ${s}s`;
}
