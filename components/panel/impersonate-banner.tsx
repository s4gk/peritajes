"use client";

import * as React from "react";
import { LogOut, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api-client";

/**
 * Banner pegajoso en la parte superior del panel mientras admin está
 * impersonando a otro usuario. El admin no puede olvidarse de que está
 * actuando como otro — el banner es ruidoso a propósito.
 */
export function ImpersonateBanner({ targetFullName }: { targetFullName: string }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  async function exitImpersonate() {
    setBusy(true);
    try {
      const res = await apiFetch("/api/admin/impersonate/exit", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show({
          title: "No se pudo salir del impersonate",
          description: data?.error,
          variant: "danger",
        });
        return;
      }
      window.location.href = "/dashboard";
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sticky top-0 z-40 flex flex-col gap-2 border-b border-warning/40 bg-warning/15 px-4 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex items-center gap-2 text-warning">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>
          Estás operando como <strong>{targetFullName}</strong>. Todo lo que
          hagas queda registrado bajo tu cuenta admin en la auditoría.
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={exitImpersonate}
        disabled={busy}
        className="gap-1.5 self-start sm:self-auto"
      >
        <LogOut className="h-3.5 w-3.5" />
        Volver a mi cuenta
      </Button>
    </div>
  );
}
