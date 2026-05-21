"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api-client";

type Company = {
  name: string;
  tagline: string;
  nit: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  logoDataUrl: string;
};

export function CompanyForm({ initial }: { initial: Company }) {
  const toast = useToast();
  const [form, setForm] = React.useState<Company>(initial);
  const [busy, setBusy] = React.useState(false);

  function update<K extends keyof Company>(key: K, value: Company[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024) {
      toast.show({
        title: "Logo demasiado grande",
        description: "Máximo 200 KB. Usa una imagen optimizada.",
        variant: "danger",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      update("logoDataUrl", String(reader.result));
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch("/api/company", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Error al guardar");
      toast.show({ title: "Datos guardados", variant: "success" });
    } catch (err) {
      toast.show({
        title: "No se pudo guardar",
        description: err instanceof Error ? err.message : undefined,
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="py-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                required
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nit">NIT</Label>
              <Input
                id="nit"
                value={form.nit}
                onChange={(e) => update("nit", e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tagline">Slogan</Label>
              <Input
                id="tagline"
                value={form.tagline}
                onChange={(e) => update("tagline", e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">Dirección</Label>
              <Textarea
                id="address"
                rows={2}
                value={form.address}
                onChange={(e) => update("address", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Teléfono</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="website">Sitio web</Label>
              <Input
                id="website"
                value={form.website}
                onChange={(e) => update("website", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2 border-t pt-5">
            <Label>Logo</Label>
            <div className="flex flex-wrap items-center gap-4">
              {form.logoDataUrl ? (
                <img
                  src={form.logoDataUrl}
                  alt="Logo"
                  className="h-16 w-16 rounded-md border bg-card object-contain p-1"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
                  Sin logo
                </div>
              )}
              <div className="flex flex-col gap-1">
                <input
                  type="file"
                  accept="image/png,image/svg+xml,image/jpeg"
                  onChange={handleLogoUpload}
                  className="text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  PNG, SVG o JPG. Máximo 200 KB.
                </p>
                {form.logoDataUrl ? (
                  <button
                    type="button"
                    className="self-start text-xs text-danger underline"
                    onClick={() => update("logoDataUrl", "")}
                  >
                    Quitar logo
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex justify-end border-t pt-5">
            <Button type="submit" disabled={busy}>
              {busy ? (
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
  );
}
