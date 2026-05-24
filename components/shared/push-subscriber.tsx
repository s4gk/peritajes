"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api-client";

/**
 * Gestiona la suscripción Web Push del device. Comportamiento:
 *  - En mount: si el SW está registrado y ya hay PushSubscription, sincroniza
 *    al server (mantiene last_used_at fresco) y no muestra nada.
 *  - Si NO hay suscripción y los permisos están en "default" (sin decidir),
 *    NO pedimos permiso automáticamente — sería intrusivo. Mostramos un
 *    banner discreto con un botón "Activar notificaciones" la primera vez
 *    que el user entra al panel, y guardamos en localStorage si lo cierra
 *    para no spamear.
 *  - Si "denied", silencio absoluto (el user dijo no, respetamos).
 *
 * Funciona solo en navegadores con PushManager. Safari iOS 16.4+ lo soporta
 * cuando la PWA está instalada en home screen.
 */
export function PushSubscriber() {
  const toast = useToast();
  const [showPrompt, setShowPrompt] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      if (!("Notification" in window)) return;

      const reg = await navigator.serviceWorker.ready.catch(() => null);
      if (!reg) return;
      if (cancelled) return;

      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        // Re-syncamos al server por si la suscripción cambió o si el server
        // perdió la fila (BD wipe, restore). Es idempotente.
        await postSubscription(existing).catch(() => {});
        return;
      }

      // Sin suscripción. Si nunca preguntamos antes y no está "denied",
      // mostramos el banner. Marcador en localStorage para no insistir.
      const dismissed = window.localStorage.getItem("perito:push-prompt-dismissed");
      if (dismissed) return;
      if (Notification.permission === "denied") return;
      setShowPrompt(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast.show({
          title: "Notificaciones bloqueadas",
          description:
            "Si cambias de opinión, podés activarlas desde la configuración del navegador.",
          variant: "warning",
        });
        setShowPrompt(false);
        window.localStorage.setItem("perito:push-prompt-dismissed", "denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const keyRes = await fetch("/api/push/vapid-public");
      const { publicKey } = (await keyRes.json()) as { publicKey: string };
      if (!publicKey) {
        toast.show({
          title: "Push no configurado en el servidor",
          variant: "danger",
        });
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const ok = await postSubscription(sub);
      if (!ok) {
        toast.show({
          title: "No se pudo registrar la suscripción",
          variant: "danger",
        });
        return;
      }
      toast.show({
        title: "Notificaciones activadas",
        description:
          "Te llegarán recordatorios de cita, peritajes firmados y alertas del sistema.",
        variant: "success",
      });
      setShowPrompt(false);
      window.localStorage.setItem("perito:push-prompt-dismissed", "granted");
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    setShowPrompt(false);
    window.localStorage.setItem("perito:push-prompt-dismissed", "later");
  }

  if (!showPrompt) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-lg border bg-card p-3 shadow-lg sm:bottom-4 sm:right-4 sm:left-auto">
      <div className="text-sm font-medium">Activar notificaciones</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Recibí avisos de citas, firmas y alertas en este dispositivo aunque
        tengas la app cerrada.
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" onClick={dismiss} disabled={busy}>
          Ahora no
        </Button>
        <Button size="sm" onClick={enable} disabled={busy}>
          {busy ? "Activando..." : "Activar"}
        </Button>
      </div>
    </div>
  );
}

async function postSubscription(sub: PushSubscription): Promise<boolean> {
  try {
    const res = await apiFetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Convierte la clave VAPID base64-url a Uint8Array que pushManager exige.
 *  Allocamos un ArrayBuffer explícito (no SharedArrayBuffer) para que TS lo
 *  tipe como BufferSource estricto que pushManager.subscribe acepta — sin
 *  esto el TS 5.9+ se queja del shape de `ArrayBufferLike`. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
