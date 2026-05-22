"use client";

import * as React from "react";
import { Loader2, PenLine, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/components/shared/signature-pad";
import { useToast } from "@/components/ui/toast";
import { ThemeToggle } from "@/components/wizard/theme-toggle";
import { apiFetch } from "@/lib/client/api-client";
import { formatDate } from "@/lib/utils";

type Profile = {
  username: string;
  fullName: string;
  email: string | null;
  licenseId: string | null;
  signatureDataUrl: string | null;
  waPhone: string | null;
  role: "admin" | "owner" | "employee";
  createdAt: string;
  lastLoginAt: string | null;
};

/**
 * Carga un File a un canvas, lo redimensiona a `maxWidth` preservando aspect
 * ratio y lo devuelve como PNG dataURL con fondo blanco. El fondo blanco evita
 * que JPGs translúcidos o PNGs transparentes se vean raros sobre el papel del
 * PDF, y nos asegura un PNG bien chico (~30-100 KB para una firma escaneada).
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
    if (naturalW === 0 || naturalH === 0) {
      throw new Error("Imagen vacía.");
    }
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

export function CuentaClient({ user }: { user: Profile }) {
  const toast = useToast();
  const [fullName, setFullName] = React.useState(user.fullName);
  const [email, setEmail] = React.useState(user.email ?? "");
  const [licenseId, setLicenseId] = React.useState(user.licenseId ?? "");
  const [waPhone, setWaPhone] = React.useState(user.waPhone ?? "");
  const [savingProfile, setSavingProfile] = React.useState(false);

  const [signature, setSignature] = React.useState<string | undefined>(
    user.signatureDataUrl ?? undefined,
  );
  const [savingSignature, setSavingSignature] = React.useState(false);
  const signatureDirty = (signature ?? null) !== (user.signatureDataUrl ?? null);

  // El SignaturePad solo dibuja `value` en el canvas durante el mount (su
  // useEffect tiene deps vacías). Cuando el perito sube una imagen, forzamos
  // un remount via `key` para que el pad se inicialice con el dataURL nuevo.
  // Dibujar a mano no cambia esta key — sólo upload.
  const [padReloadKey, setPadReloadKey] = React.useState(0);
  const signatureFileRef = React.useRef<HTMLInputElement>(null);
  const [uploadBusy, setUploadBusy] = React.useState(false);

  async function handleSignatureUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.show({
        title: "Archivo inválido",
        description: "Sube una imagen (PNG o JPG).",
        variant: "warning",
      });
      return;
    }
    setUploadBusy(true);
    try {
      const dataUrl = await resizeSignatureFile(file, 1000);
      setSignature(dataUrl);
      setPadReloadKey((k) => k + 1);
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

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function saveSignature() {
    if (!signatureDirty || savingSignature) return;
    setSavingSignature(true);
    try {
      const res = await apiFetch("/api/auth/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signatureDataUrl: signature ?? null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Error");
      }
      toast.show({
        title: signature ? "Firma guardada" : "Firma eliminada",
        description: signature
          ? "Se va a pre-rellenar en cada peritaje nuevo."
          : "Vas a tener que firmar manualmente en cada peritaje.",
        variant: "success",
      });
      window.location.reload();
    } catch (err) {
      toast.show({
        title: "No se pudo guardar la firma",
        description: err instanceof Error ? err.message : undefined,
        variant: "danger",
      });
      setSavingSignature(false);
    }
  }

  const profileDirty =
    fullName.trim() !== user.fullName ||
    email.trim() !== (user.email ?? "") ||
    licenseId.trim() !== (user.licenseId ?? "") ||
    waPhone.trim() !== (user.waPhone ?? "");

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profileDirty || savingProfile) return;
    setSavingProfile(true);
    try {
      const res = await apiFetch("/api/auth/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim() || null,
          licenseId: licenseId.trim() || null,
          waPhone: waPhone.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Error");
      }
      toast.show({
        title: "Perfil actualizado",
        description: "Tus nuevos peritajes ya van a usar estos datos.",
        variant: "success",
      });
      // Refresh the server-rendered panel layout so PanelUser picks up the new
      // values (otherwise the wizard would still see the old fullName).
      window.location.reload();
    } catch (err) {
      toast.show({
        title: "No se pudo guardar",
        description: err instanceof Error ? err.message : undefined,
        variant: "danger",
      });
      setSavingProfile(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.show({
        title: "Las contraseñas no coinciden",
        variant: "danger",
      });
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch("/api/auth/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Error");
      }
      toast.show({
        title: "Contraseña actualizada",
        description: "Vuelve a iniciar sesión.",
        variant: "success",
      });
      setTimeout(() => {
        window.location.href = "/login";
      }, 800);
    } catch (err) {
      toast.show({
        title: "No se pudo cambiar",
        description: err instanceof Error ? err.message : undefined,
        variant: "danger",
      });
      setBusy(false);
    }
  }

  return (
    <div className="container max-w-3xl space-y-5 py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Mi cuenta
        </h1>
        <p className="text-sm text-muted-foreground">
          Tu perfil y preferencias.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos del perito</CardTitle>
          <CardDescription>
            Estos datos se usan para autocompletar el campo "Perito" en cada peritaje
            que crees.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Nombre completo *</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Carlos Mendoza"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="licenseId">Licencia / Documento</Label>
                <Input
                  id="licenseId"
                  value={licenseId}
                  onChange={(e) => setLicenseId(e.target.value)}
                  placeholder="PI-20451 o tu cédula"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="perito@vestel.com.co"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="waPhone">WhatsApp</Label>
                <Input
                  id="waPhone"
                  type="tel"
                  value={waPhone}
                  onChange={(e) => setWaPhone(e.target.value)}
                  placeholder="+57 310 555 1234"
                />
                <p className="text-xs text-muted-foreground">
                  Para recibir avisos internos (intake nuevo, firmas).
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Usuario</Label>
                <Input value={`@${user.username}`} disabled />
              </div>
              <div className="space-y-1.5">
                <Label>Rol</Label>
                <Input
                  value={user.role === "admin" ? "Administrador" : "Dueño"}
                  disabled
                />
              </div>
            </div>
            <div className="flex flex-col gap-1 border-t pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                Creada {formatDate(user.createdAt)} · Último acceso{" "}
                {user.lastLoginAt ? formatDate(user.lastLoginAt) : "—"}
              </span>
              <Button type="submit" disabled={!profileDirty || savingProfile}>
                {savingProfile ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Guardando...
                  </>
                ) : (
                  "Guardar cambios"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PenLine className="h-4 w-4 text-muted-foreground" />
            Firma del perito
          </CardTitle>
          <CardDescription>
            Si la guardas aquí, se va a usar como firma por defecto en cada peritaje
            que crees. Igual puedes sobreescribirla en cada peritaje al finalizar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <SignaturePad
            key={padReloadKey}
            label={`Firma de ${user.fullName}`}
            hint={
              user.licenseId
                ? `Identificación profesional: ${user.licenseId}`
                : "Dibújala con el dedo o sube una imagen escaneada."
            }
            value={signature}
            onChange={setSignature}
          />
          <input
            ref={signatureFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handleSignatureUpload(f);
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => signatureFileRef.current?.click()}
              disabled={uploadBusy || savingSignature}
            >
              {uploadBusy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-4 w-4" />
              )}{" "}
              {uploadBusy ? "Procesando…" : "Subir imagen"}
            </Button>
            <Button onClick={saveSignature} disabled={!signatureDirty || savingSignature || uploadBusy}>
              {savingSignature ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Guardando...
                </>
              ) : signature ? (
                "Guardar firma"
              ) : (
                "Eliminar firma"
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            PNG, JPG o WEBP — idealmente firma escaneada con fondo blanco. La
            imagen se redimensiona automáticamente a 1000px de ancho.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tema</CardTitle>
          <CardDescription>
            Claro, oscuro o alto contraste para uso al sol.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cambiar contraseña</CardTitle>
          <CardDescription>
            Al cambiarla, se cierra esta sesión y deberás ingresar de nuevo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="np">Nueva contraseña</Label>
              <Input
                id="np"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np2">Confirmar</Label>
              <Input
                id="np2"
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Guardando...
                </>
              ) : (
                "Cambiar contraseña"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
