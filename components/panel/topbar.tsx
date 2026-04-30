"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export type TopbarProps = {
  user: { fullName: string; role: "admin" | "perito" };
  onMenuClick: () => void;
  title?: string;
};

export function Topbar({ user, onMenuClick, title }: TopbarProps) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error("Error al cerrar sesión");
      router.replace("/login");
      router.refresh();
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
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
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
