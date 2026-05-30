import { ArrowDownRight, ArrowUpRight, Minus, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { InspectorStat } from "@/lib/server/org-stats";
import { cn } from "@/lib/utils";

function deltaIcon(current: number, prev: number) {
  if (current > prev) return <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />;
  if (current < prev) return <ArrowDownRight className="h-3.5 w-3.5 text-red-400" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function lastActive(iso: string | null): string {
  if (!iso) return "Sin actividad";
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Hoy";
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) return `Hace ${diffDays} días`;
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
}

export function InspectorStats({ stats }: { stats: InspectorStat[] }) {
  if (stats.length === 0) return null;

  const teamTotal = stats.reduce((s, r) => s + r.thisMonth, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Users className="h-4 w-4 text-muted-foreground" />
          Rendimiento del equipo — este mes
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {stats.map((s) => {
            const pct = teamTotal > 0 ? Math.round((s.thisMonth / teamTotal) * 100) : 0;
            return (
              <div
                key={s.userId}
                className="flex items-center gap-4 px-6 py-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{s.fullName}</span>
                    {s.role === "owner" && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        dueño
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{s.total} total</span>
                    <span>·</span>
                    <span>{s.completed} completados</span>
                    {s.drafts > 0 && (
                      <>
                        <span>·</span>
                        <span className="text-amber-500">{s.drafts} borrador{s.drafts > 1 ? "es" : ""}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{lastActive(s.lastActiveAt)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <span className="text-lg font-bold tabular-nums">{s.thisMonth}</span>
                      {deltaIcon(s.thisMonth, s.lastMonth)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{pct}% del equipo</div>
                  </div>
                  <div className="w-16 hidden sm:block">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          pct >= 50 ? "bg-emerald-500" : pct >= 25 ? "bg-amber-400" : "bg-muted-foreground/40",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {stats.length > 1 && (
          <div className="px-6 py-3 border-t bg-muted/30 flex justify-between text-xs text-muted-foreground">
            <span>Total equipo este mes</span>
            <span className="font-semibold text-foreground">{teamTotal} peritajes</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
