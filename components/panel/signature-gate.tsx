"use client";

import * as React from "react";
import { ShieldAlert, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { SignaturePad } from "@/components/shared/signature-pad";
import { apiFetch } from "@/lib/client/api-client";
import type { PanelUser } from "./current-user";

/**
 * Reescala una imagen de firma a un PNG con fondo blanco y ancho acotado.
 * Mismo criterio que /cuenta: mantiene el archivo chico (~30-100 KB) y
 * descarta canales alfa que el motor de PDF a veces renderiza en negro.
 */
async function resizeSignatureFile(file: File, maxWidth: number): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No se pudo decodificar la imagen."));
      i.src = objectUrl;
    });
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (naturalW === 0 || naturalH === 0) throw new Error("Imagen vacía.");
    const ratio = Math.min(1, maxWidth / naturalW);
    const w = Math.max(1, Math.round(naturalW * ratio));
    const h = Math.max(1, Math.round(naturalH * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas no disponible.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Gate de firma. Quien hace peritajes (owner / employee) no puede operar en el
 * panel hasta tener su firma cargada en el sistema — antes se pedía por cada
 * peritaje, ahora es un requisito de cuenta. El admin de plataforma no firma
 * peritajes, así que queda exento. El bloqueo es un overlay full-screen no
 * descartable: se resuelve firmando ahí mismo (dibujo o imagen).
 */
export function SignatureGate({
  user,
  children,
}: {
  user: PanelUser;
  children: React.ReactNode;
}) {
  const mustSign = user.role !== "admin" && !user.signatureDataUrl;
  if (!mustSign) return <>{children}</>;
  return (
    <>
      {children}
      <SignatureBlocker />
    </>
  );
}

function SignatureBlocker() {
  const toast = useToast();
  const [signature, setSignature] = React.useState<string | undefined>(undefined);
  const [saving, setSaving] = React.useState(false);
  const [uploadBusy, setUploadBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function handleUpload(file: File) {
    setUploadBusy(true);
    try {
      setSignature(await resizeSignatureFile(file, 1000));
    } catch (err) {
      toast.show({
        title: "No se pudo cargar la imagen",
        description: err instanceof Error ? err.message : undefined,
        variant: "danger",
      });
    } finally {
      setUploadBusy(false);
    }
  }

  async function save() {
    if (!signature || saving) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/auth/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signatureDataUrl: signature }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Error");
      }
      toast.show({ title: "Firma guardada", variant: "success" });
      // Recargamos para que el layout server lea la firma y abra el gate.
      window.location.reload();
    } catch (err) {
      toast.show({
        title: "No se pudo guardar la firma",
        description: err instanceof Error ? err.message : undefined,
        variant: "danger",
      });
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-background/95 p-4 backdrop-blur sm:items-center">
      <div className="my-auto w-full max-w-md space-y-4 rounded-xl border bg-card p-5 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h1 className="text-base font-semibold">
              Carga tu firma para continuar
            </h1>
            <p className="text-sm text-muted-foreground">
              Necesitas registrar tu firma una sola vez. Hasta entonces no
              puedes operar en el sistema; se usará automáticamente en todos tus
              peritajes.
            </p>
          </div>
        </div>

        <SignaturePad
          label="Tu firma"
          value={signature}
          onChange={setSignature}
          hint="Dibújala con el dedo / mouse o sube una imagen."
        />

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUpload(f);
            e.target.value = "";
          }}
        />

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={uploadBusy || saving}
            className="flex-1"
          >
            <Upload className="mr-2 h-4 w-4" />
            {uploadBusy ? "Cargando…" : "Subir imagen"}
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={!signature || saving || uploadBusy}
            className="flex-1"
          >
            {saving ? "Guardando…" : "Guardar y continuar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
