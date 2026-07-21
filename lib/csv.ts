import { analyze } from "./rules-engine";
import { economicLevelLabel, formatCostRange, riskLevelLabel } from "./scoring";
import type { StoredInspection } from "./types";

type AppointmentRow = {
  scheduledAt: string;
  ownerName: string;
  ownerPhone: string;
  plate: string;
  location: string;
  notes: string;
  status: string;
  inspectionId: string | null;
  createdAt: string;
};

/**
 * Helpers de export CSV — sin dependencias, sin server side. Escapamos según
 * RFC 4180 (comillas dobles → "" y campo entre comillas si contiene coma,
 * comilla o salto de línea).
 */

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s === "") return "";
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines: string[] = [];
  lines.push(headers.map(csvEscape).join(","));
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  // Sembramos BOM UTF-8 para que Excel detecte el encoding y no rompa tildes.
  return "﻿" + lines.join("\r\n");
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

export function inspectionsToCsv(rows: StoredInspection[]): string {
  const headers = [
    "Consecutivo",
    "Placa",
    "VIN",
    "Marca",
    "Modelo",
    "Año",
    "Propietario",
    "Documento",
    "Teléfono",
    "Perito",
    "Fecha inspección",
    "Hallazgos",
    "Riesgo",
    "Impacto económico",
    "Costo estimado reparación",
    "Creado",
    "Actualizado",
  ];
  const data = rows.map((r) => {
    const v = r.data.vehicle;
    let findings = 0;
    let risk = "—";
    let economic = "—";
    let cost = "—";
    try {
      const report = analyze(r.data);
      findings = report.findings.length;
      risk = riskLevelLabel(report.level);
      economic = economicLevelLabel(report.economicImpact);
      cost = formatCostRange(report.estimatedRepairCost);
    } catch {
      /* análisis no esencial para el CSV */
    }
    return [
      r.reportNumber ?? "",
      v.plate,
      v.vin,
      v.make,
      v.model,
      v.year,
      v.owner,
      v.ownerDocument,
      v.ownerPhone,
      v.inspector,
      v.date,
      findings,
      risk,
      economic,
      cost,
      r.createdAt,
      r.updatedAt,
    ];
  });
  return toCsv(headers, data);
}

const APPT_STATUS_LABEL: Record<string, string> = {
  scheduled: "Programada",
  in_progress: "En curso",
  completed: "Completada",
  cancelled: "Cancelada",
  no_show: "No se presentó",
};

export function appointmentsToCsv(rows: AppointmentRow[]): string {
  const headers = [
    "Fecha",
    "Hora",
    "Estado",
    "Placa",
    "Propietario",
    "Teléfono",
    "Lugar",
    "Peritaje",
    "Notas",
    "Creada",
  ];
  const data = rows.map((a) => {
    const d = new Date(a.scheduledAt);
    const date = d.toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const time = d.toLocaleTimeString("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return [
      date,
      time,
      APPT_STATUS_LABEL[a.status] ?? a.status,
      a.plate,
      a.ownerName,
      a.ownerPhone,
      a.location,
      a.inspectionId ?? "",
      a.notes,
      a.createdAt,
    ];
  });
  return toCsv(headers, data);
}
