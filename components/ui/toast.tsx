"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ToastMessage = {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "success" | "warning" | "danger";
};

type ToastContextValue = {
  show: (t: Omit<ToastMessage, "id">) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastMessage[]>([]);

  const show = React.useCallback((t: Omit<ToastMessage, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { ...t, id }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-3 top-3 z-[100] flex flex-col gap-2 sm:inset-auto sm:bottom-4 sm:right-4 sm:top-auto sm:w-full sm:max-w-sm"
        style={{ paddingTop: "max(0.25rem, env(safe-area-inset-top))" }}
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-lg border bg-background p-3 shadow-lg sm:p-4",
              t.variant === "success" && "border-success/50 bg-success/10",
              t.variant === "warning" && "border-warning/50 bg-warning/10",
              t.variant === "danger" && "border-danger/50 bg-danger/10",
            )}
          >
            <div className="font-semibold text-sm">{t.title}</div>
            {t.description && (
              <div className="mt-1 text-sm text-muted-foreground">
                {t.description}
              </div>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
