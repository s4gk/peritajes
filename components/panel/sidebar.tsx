"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Building2,
  Calendar,
  Car,
  ClipboardList,
  DatabaseBackup,
  LayoutDashboard,
  MessageCircle,
  ScrollText,
  UserCircle,
  Users,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agenda", label: "Agenda", icon: Calendar },
  { href: "/peritajes", label: "Peritajes", icon: ClipboardList },
  { href: "/vehiculos", label: "Vehículos", icon: Car },
  { href: "/empresa", label: "Empresa", icon: Building2 },
  { href: "/usuarios", label: "Usuarios", icon: Users },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/auditoria", label: "Auditoría", icon: ScrollText, adminOnly: true },
  { href: "/backup", label: "Backup", icon: DatabaseBackup },
  { href: "/cuenta", label: "Mi cuenta", icon: UserCircle },
];

export type SidebarProps = {
  user: { fullName: string; username: string; role: "admin" | "owner" };
  open: boolean;
  onClose: () => void;
};

export function Sidebar({ user, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const items = NAV.filter((i) => !i.adminOnly || user.role === "admin");

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card transition-transform lg:sticky lg:inset-auto lg:top-0 lg:h-screen lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <Image
              src="/logo.jpg"
              alt="Peritajes del Llano"
              width={32}
              height={32}
              className="h-8 w-8 rounded-md object-cover"
              priority
            />
            <span className="truncate text-sm">Peritajes del Llano</span>
          </Link>
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted lg:hidden"
            onClick={onClose}
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-1">
            {items.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t p-3">
          <div className="rounded-md bg-muted/40 px-3 py-2.5 text-xs">
            <div className="truncate font-medium text-foreground">
              {user.fullName}
            </div>
            <div className="truncate text-muted-foreground">
              @{user.username} ·{" "}
              {user.role === "admin" ? "Administrador" : "Dueño"}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
