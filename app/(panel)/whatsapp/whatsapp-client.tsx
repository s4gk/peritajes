"use client";

import * as React from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api-client";

type Status = {
  provider?: "meta";
  status: "disconnected" | "connected";
  phone: string | null;
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
  }, [refresh]);

  async function handleTestMessage() {
    setBusy(true);
    try {
      const res = await apiFetch("/api/admin/whatsapp/test-message", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show({
          title: "No se pudo enviar la prueba",
          description: data?.error,
          variant: "danger",
        });
        return;
      }
      toast.show({
        title: "Mensaje de prueba enviado",
        description: data?.phone
          ? `Revisa el WhatsApp del +${data.phone} en unos segundos.`
          : "Revisa tu WhatsApp en unos segundos.",
        variant: "success",
      });
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

  const isConnected = state.status === "connected";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Integración con la API oficial de WhatsApp Business de Meta. Los
          mensajes (intake nuevo, link de firma, PDF final, recordatorios) se
          envían mediante plantillas aprobadas por Meta.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4" /> Estado de conexión
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-normal text-primary">
              API Oficial
            </span>
          </CardTitle>
          <Badge variant={isConnected ? "success" : "secondary"}>
            {isConnected ? "Conectado" : "Sin configurar"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.phone && (
            <div className="text-sm">
              <span className="text-muted-foreground">Número de empresa:</span>{" "}
              <span className="font-mono">+{state.phone}</span>
            </div>
          )}
          {isConnected && (
            <div className="text-sm text-muted-foreground">
              Token configurado y activo.
            </div>
          )}
          {state.lastError && (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              {state.lastError}
            </div>
          )}

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            El botón de prueba envía un texto libre a tu número de WhatsApp
            personal (requiere que hayas escrito al número de empresa en las
            últimas 24 h).
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            {isConnected && (
              <Button onClick={handleTestMessage} disabled={busy}>
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Enviar mensaje de prueba
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="rounded-md border bg-muted/30 p-4 text-xs text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">Recomendaciones</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Para que los mensajes lleguen, crea las plantillas en{" "}
            <strong>Meta Business Manager</strong> con los nombres exactos
            documentados en <code>lib/server/whatsapp-meta.ts</code>.
          </li>
          <li>
            Registra el webhook <code>/api/webhooks/whatsapp</code> en Meta para
            recibir confirmaciones de entrega y mensajes entrantes, y configura{" "}
            <code>META_WA_APP_SECRET</code> para validar la firma.
          </li>
          <li>
            Asegúrate que cada usuario del equipo tenga su teléfono WA en{" "}
            <strong>Mi cuenta</strong> para recibir avisos internos.
          </li>
        </ul>
      </div>
    </div>
  );
}
