"use client";

import * as React from "react";

import { UIPreferencesProvider } from "@/components/wizard/ui-preferences";

import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export type PanelUser = {
  id: string;
  username: string;
  fullName: string;
  role: "admin" | "perito";
};

export function PanelShell({
  user,
  children,
}: {
  user: PanelUser;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <UIPreferencesProvider>
      <div className="flex min-h-screen bg-muted/30">
        <Sidebar user={user} open={open} onClose={() => setOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar user={user} onMenuClick={() => setOpen(true)} />
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </UIPreferencesProvider>
  );
}
