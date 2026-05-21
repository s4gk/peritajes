"use client";

import * as React from "react";
import { Loader2, LogOut, MessageCircle, RefreshCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api-client";
import { formatDate } from "@/lib/utils";

type Status = {
  status: "disconnected" | "connecting" | "qr" | "connected";
  phone: string | null;
  qrDataUrl: string | null;
  connectedAt: number | null;
  lastError: string | null;
  queueSize: number;
};

export function WhatsAppClient() {
  const toast = useToast();
  const [state, setState] = React.useState<Status | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const res = await apiFetch("/api/admin/whatsapp/status");
    if (res.ok) {
      const data = (await res.json()) as Status;
      setState(data);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    // Mientras estamos esperando el QR o la confirmación de conexión, polleamos
    // cada 2 segundos para que la UI reaccione rápido. Cuando ya está conectado
    // bajamos la frecuencia.
    const id = setInterval(() => {
      void refresh();
    }, 2_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function handleConnect() {
    setBusy(true);
    try {
      const res = await apiFetch("/api/admin/whatsapp/connect", {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.show({
          title: "No se pudo iniciar la conexión",
          description: data?.error,
          variant: "danger",
        });
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    if (!confirm("¿Desconectar WhatsApp? Vas a tener que escanear el QR de nuevo.")) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/admin/whatsapp/logout", { method: "POST" });
      await refresh();
      toast.show({ title: "WhatsApp desconectado", variant: "success" });
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando estado…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Conecta un número de WhatsApp para enviar notificaciones al equipo
          (intake nuevo, firma completada) y al cliente (link de firma, PDF
          final).
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4" /> Estado de conexión
          </CardTitle>
          <StatusBadge status={state.status} />
        </CardHeader>
        <CardContent className="space-y-4">
          {state.phone && (
            <div className="text-sm">
              <span className="text-muted-foreground">Número conectado:</span>{" "}
              <span className="font-mono">+{state.phone}</span>
            </div>
          )}
          {state.connectedAt && (
            <div className="text-sm text-muted-foreground">
              Conectado desde {formatDate(new Date(state.connectedAt).toISOString())}
            </div>
          )}
          {state.queueSize > 0 && (
            <div className="text-sm text-muted-foreground">
              {state.queueSize} mensaje(s) en cola.
            </div>
          )}
          {state.lastError && state.lastError !== "logged-out" && (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              Último error: {state.lastError}
            </div>
          )}

          {state.status === "qr" && state.qrDataUrl && (
            <div className="space-y-2">
              <p className="text-sm">
                Abre WhatsApp en tu teléfono → <strong>Dispositivos vinculados</strong>{" "}
                → <strong>Vincular un dispositivo</strong> y escanea este QR:
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.qrDataUrl}
                alt="QR de WhatsApp"
                className="mx-auto h-72 w-72 rounded-md border bg-white p-2"
              />
              <p className="text-xs text-muted-foreground">
                El QR se renueva automáticamente cada ~20s. No te preocupes si
                cambia en pantalla.
              </p>
            </div>
          )}

          {state.status === "connecting" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Conectando…
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            {(state.status === "disconnected" || state.status === "qr") && (
              <Button onClick={handleConnect} disabled={busy}>
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 h-4 w-4" />
                )}
                {state.status === "qr" ? "Renovar QR" : "Conectar"}
              </Button>
            )}
            {state.status === "connected" && (
              <Button variant="outline" onClick={handleLogout} disabled={busy}>
                <LogOut className="mr-2 h-4 w-4" /> Desconectar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="rounded-md border bg-muted/30 p-4 text-xs text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">Recomendaciones</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>Usa un número dedicado al negocio, no el personal.</li>
          <li>
            Asegúrate que cada usuario del equipo tenga su teléfono WA en{" "}
            <strong>Mi cuenta</strong> para recibir avisos internos.
          </li>
          <li>
            Cargá el teléfono del cliente en el peritaje (paso{" "}
            <em>Vehículo / Propietario</em>) para que reciba el link de firma y
            el PDF.
          </li>
        </ul>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status["status"] }) {
  const map: Record<
    Status["status"],
    { label: string; variant: "default" | "success" | "warning" | "secondary" }
  > = {
    disconnected: { label: "Desconectado", variant: "secondary" },
    connecting: { label: "Conectando", variant: "warning" },
    qr: { label: "Esperando QR", variant: "warning" },
    connected: { label: "Conectado", variant: "success" },
  };
  const meta = map[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
