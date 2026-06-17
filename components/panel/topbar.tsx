"use client";

import * as React from "react";
import { LogOut, Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ThemeToggle } from "@/components/wizard/theme-toggle";
import { apiFetch } from "@/lib/client/api-client";
import { flushSyncQueue } from "@/lib/client/sync-queue";
import { wipeLocalUserData } from "@/lib/inspections-store";

import { HelpButton } from "./tour/help-button";

export type TopbarProps = {
  user: { fullName: string; role: "admin" | "owner" | "employee" };
  onMenuClick: () => void;
  title?: string;
};

export function Topbar({ user, onMenuClick, title }: TopbarProps) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      // 1. Subir lo pendiente mientras la sesión de este usuario sigue viva,
      //    así no perdemos peritajes sin sincronizar al limpiar la cola.
      await flushSyncQueue().catch(() => {});
      // 2. Cerrar sesión en el server (borra cookie + fila de sesión).
      const res = await apiFetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error("Error al cerrar sesión");
      // 3. Botar TODO el estado local (memory + IndexedDB + caches del SW) para
      //    que el próximo usuario en este dispositivo no herede peritajes ni
      //    identidad ajenos. Sin esto, en tablets compartidas los peritajes del
      //    usuario anterior aparecían "a nombre del otro".
      await wipeLocalUserData().catch(() => {});
      // 4. Recarga dura (no SPA) para botar el memory singleton del bundle y
      //    re-arrancar el store limpio desde cero en /login.
      window.location.href = "/login";
    } catch (err) {
      toast.show({
        title: "No se pudo cerrar sesión",
        description: err instanceof Error ? err.message : undefined,
        variant: "danger",
      });
      setBusy(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 sm:px-6 lg:px-12 xl:px-20 backdrop-blur">
      <button
        type="button"
        onClick={onMenuClick}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted lg:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" />
      </button>
      <div className="flex-1 truncate">
        {title ? (
          <h1 className="truncate text-base font-semibold sm:text-lg">{title}</h1>
        ) : null}
      </div>
      <HelpButton />
      <ThemeToggle />
      <div className="hidden items-center gap-2 text-sm sm:flex">
        <span className="text-muted-foreground">Hola,</span>
        <span className="font-medium">{user.fullName.split(" ")[0]}</span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleLogout}
        disabled={busy}
        className="gap-1.5"
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline">Salir</span>
      </Button>
    </header>
  );
}
