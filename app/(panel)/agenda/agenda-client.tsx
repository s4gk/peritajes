"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  CalendarClock,
  CalendarDays,
  Car,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  List,
  MapPin,
  Pencil,
  Phone,
  Play,
  Plus,
  StickyNote,
  Trash2,
  User as UserIcon,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api-client";
import { appointmentsToCsv, downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

type AppointmentStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

type Appointment = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  ownerName: string;
  ownerPhone: string;
  ownerDocument: string;
  plate: string;
  vehicleLabel: string;
  location: string;
  notes: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  inspectionId: string | null;
  status: AppointmentStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  initialAppointments: Appointment[];
  currentUser: { id: string; role: "admin" | "perito" };
};

type FormState = {
  scheduledDate: string;
  scheduledTime: string;
  ownerName: string;
  ownerPhone: string;
  plate: string;
  location: string;
  notes: string;
};

const STATUS_META: Record<
  AppointmentStatus,
  { label: string; tone: "default" | "success" | "warning" | "danger" | "neutral" }
> = {
  scheduled: { label: "Programada", tone: "default" },
  in_progress: { label: "En curso", tone: "warning" },
  completed: { label: "Completada", tone: "success" },
  cancelled: { label: "Cancelada", tone: "neutral" },
  no_show: { label: "No se presentó", tone: "danger" },
};

function emptyForm(): FormState {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return {
    scheduledDate: `${yyyy}-${mm}-${dd}`,
    scheduledTime: `${hh}:${mi}`,
    ownerName: "",
    ownerPhone: "",
    plate: "",
    location: "",
    notes: "",
  };
}

function formToScheduledAt(form: FormState): string {
  return new Date(`${form.scheduledDate}T${form.scheduledTime}`).toISOString();
}

function formFromAppointment(appt: Appointment): FormState {
  const d = new Date(appt.scheduledAt);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return {
    scheduledDate: `${yyyy}-${mm}-${dd}`,
    scheduledTime: `${hh}:${mi}`,
    ownerName: appt.ownerName,
    ownerPhone: appt.ownerPhone,
    plate: appt.plate,
    location: appt.location,
    notes: appt.notes,
  };
}

type Bucket = {
  key: string;
  label: string;
  items: Appointment[];
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function bucketize(appts: Appointment[]): Bucket[] {
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + 7);

  const buckets: Bucket[] = [
    { key: "past", label: "Pasadas", items: [] },
    { key: "today", label: "Hoy", items: [] },
    { key: "tomorrow", label: "Mañana", items: [] },
    { key: "week", label: "Esta semana", items: [] },
    { key: "later", label: "Más adelante", items: [] },
  ];

  for (const a of appts) {
    const d = new Date(a.scheduledAt);
    if (d < today) {
      // Si está cancelada/completada/no-show, la mandamos al final igual.
      buckets[0].items.push(a);
      continue;
    }
    const day = startOfDay(d);
    if (day.getTime() === today.getTime()) buckets[1].items.push(a);
    else if (day.getTime() === tomorrow.getTime()) buckets[2].items.push(a);
    else if (day < endOfWeek) buckets[3].items.push(a);
    else buckets[4].items.push(a);
  }

  // Past al final, el resto en orden cronológico — ya viene ordenado del server
  // pero por si acaso garantizamos:
  for (const b of buckets) {
    b.items.sort((x, y) => (x.scheduledAt < y.scheduledAt ? -1 : 1));
  }
  return buckets.filter((b) => b.items.length > 0);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDayLong(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

type ViewMode = "list" | "calendar";

export function AgendaClient({ initialAppointments, currentUser }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [appointments, setAppointments] = React.useState<Appointment[]>(initialAppointments);
  const [editing, setEditing] = React.useState<Appointment | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(emptyForm);
  const [busy, setBusy] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<ViewMode>("list");
  const [calendarMonth, setCalendarMonth] = React.useState<Date>(() => {
    const d = startOfDay(new Date());
    d.setDate(1);
    return d;
  });
  const [selectedDay, setSelectedDay] = React.useState<Date>(() => startOfDay(new Date()));

  const isAdmin = currentUser.role === "admin";

  function handleExportCsv() {
    const csv = appointmentsToCsv(appointments);
    downloadCsv(csv, `agenda-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  async function refresh() {
    try {
      const res = await fetch("/api/appointments", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { appointments: Appointment[] };
      setAppointments(json.appointments);
    } catch {
      /* ignore */
    }
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(appt: Appointment) {
    setEditing(appt);
    setForm(formFromAppointment(appt));
    setDialogOpen(true);
  }

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        scheduledAt: formToScheduledAt(form),
        ownerName: form.ownerName,
        ownerPhone: form.ownerPhone,
        plate: form.plate,
        location: form.location,
        notes: form.notes,
      };
      const res = await apiFetch(
        editing ? `/api/appointments/${editing.id}` : "/api/appointments",
        {
          method: editing ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show({
          title: editing ? "No se pudo actualizar" : "No se pudo crear la cita",
          description: data?.error,
          variant: "danger",
        });
        return;
      }
      toast.show({
        title: editing ? "Cita actualizada" : "Cita creada",
        variant: "success",
      });
      setDialogOpen(false);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(appt: Appointment, status: AppointmentStatus) {
    const res = await apiFetch(`/api/appointments/${appt.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      toast.show({ title: "No se pudo cambiar el estado", variant: "danger" });
      return;
    }
    refresh();
  }

  async function startInspection(appt: Appointment) {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/appointments/${appt.id}/start`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show({
          title: "No se pudo iniciar el peritaje",
          description: data?.error,
          variant: "danger",
        });
        return;
      }
      router.push(`/inspection/${data.inspectionId}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(appt: Appointment) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`¿Eliminar la cita de ${appt.ownerName || "—"} (${appt.plate || "sin placa"})?`)
    ) {
      return;
    }
    const res = await apiFetch(`/api/appointments/${appt.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.show({ title: "No se pudo eliminar", variant: "danger" });
      return;
    }
    refresh();
  }

  const buckets = React.useMemo(() => bucketize(appointments), [appointments]);

  return (
    <div className="space-y-6 pb-20 sm:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Agenda</h1>
          <p className="text-sm text-muted-foreground">
            {appointments.length === 0
              ? "No tenés citas registradas. Creá la primera para empezar."
              : `${appointments.length} cita${appointments.length === 1 ? "" : "s"} registrada${appointments.length === 1 ? "" : "s"}.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors",
                viewMode === "list"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="h-4 w-4" />
              Lista
            </button>
            <button
              type="button"
              onClick={() => setViewMode("calendar")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors",
                viewMode === "calendar"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Calendar className="h-4 w-4" />
              Calendario
            </button>
          </div>
          {appointments.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              className="gap-1.5"
              title="Descargar CSV de la agenda completa"
            >
              <FileSpreadsheet className="h-4 w-4" />
              CSV
            </Button>
          )}
          <Button onClick={openCreate} size="lg" className="hidden h-10 sm:inline-flex">
            <Plus className="mr-1 h-4 w-4" />
            Nueva cita
          </Button>
        </div>
      </div>

      {viewMode === "calendar" && appointments.length > 0 && (
        <CalendarView
          monthAnchor={calendarMonth}
          setMonthAnchor={setCalendarMonth}
          selectedDay={selectedDay}
          setSelectedDay={setSelectedDay}
          appointments={appointments}
          onCardEdit={openEdit}
          onCardStart={startInspection}
          onCardCancel={(a) => changeStatus(a, "cancelled")}
          onCardNoShow={(a) => changeStatus(a, "no_show")}
          onCardComplete={(a) => changeStatus(a, "completed")}
          onCardDelete={remove}
          onCardOpenInspection={(a) =>
            a.inspectionId ? router.push(`/inspection/${a.inspectionId}`) : undefined
          }
          canDelete={(a) => isAdmin || a.createdBy === currentUser.id}
          busy={busy}
        />
      )}

      {appointments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="rounded-full bg-muted p-4">
              <Calendar className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <div className="text-base font-medium">Aún no hay citas</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Programá la primera para tener trazabilidad entre la reserva y el peritaje.
              </div>
            </div>
            <Button onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" /> Nueva cita
            </Button>
          </CardContent>
        </Card>
      ) : viewMode === "list" ? (
        <div className="space-y-8">
          {buckets.map((bucket) => (
            <section key={bucket.key} className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {bucket.label}
                </h2>
                <Badge variant="neutral" className="text-[10px]">
                  {bucket.items.length}
                </Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {bucket.items.map((appt) => (
                  <AppointmentCard
                    key={appt.id}
                    appointment={appt}
                    canDelete={isAdmin || appt.createdBy === currentUser.id}
                    busy={busy}
                    onEdit={() => openEdit(appt)}
                    onStart={() => startInspection(appt)}
                    onCancel={() => changeStatus(appt, "cancelled")}
                    onNoShow={() => changeStatus(appt, "no_show")}
                    onComplete={() => changeStatus(appt, "completed")}
                    onDelete={() => remove(appt)}
                    onOpenInspection={
                      appt.inspectionId
                        ? () => router.push(`/inspection/${appt.inspectionId}`)
                        : null
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={openCreate}
        aria-label="Nueva cita"
        className="fixed right-4 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground shadow-xl shadow-primary/30 transition-transform active:scale-95 sm:hidden"
        style={{ bottom: "max(1rem, calc(env(safe-area-inset-bottom) + 0.75rem))" }}
      >
        <Plus className="h-5 w-5" />
        Nueva cita
      </button>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar cita" : "Nueva cita"}
            </DialogTitle>
            <DialogDescription>
              Programá fecha, hora y datos del cliente. Al iniciar el peritaje desde la
              cita esos datos se transfieren al informe.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <FormSection icon={CalendarDays} title="Cuándo">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="agenda-date">Fecha</Label>
                  <Input
                    id="agenda-date"
                    type="date"
                    value={form.scheduledDate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, scheduledDate: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agenda-time">Hora</Label>
                  <Input
                    id="agenda-time"
                    type="time"
                    value={form.scheduledTime}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, scheduledTime: e.target.value }))
                    }
                  />
                </div>
              </div>
            </FormSection>

            <FormSection icon={Car} title="Vehículo">
              <div className="space-y-1.5">
                <Label htmlFor="agenda-plate">Placa</Label>
                <Input
                  id="agenda-plate"
                  placeholder="ABC123"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono uppercase tracking-wider"
                  value={form.plate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, plate: e.target.value.toUpperCase() }))
                  }
                />
              </div>
            </FormSection>

            <FormSection icon={UserIcon} title="Cliente">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="agenda-owner">Nombre</Label>
                  <Input
                    id="agenda-owner"
                    placeholder="Nombre del propietario"
                    value={form.ownerName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, ownerName: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agenda-phone">Teléfono</Label>
                  <Input
                    id="agenda-phone"
                    type="tel"
                    inputMode="tel"
                    placeholder="3001234567"
                    value={form.ownerPhone}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, ownerPhone: e.target.value }))
                    }
                  />
                </div>
              </div>
            </FormSection>

            <FormSection icon={MapPin} title="Dónde">
              <div className="space-y-1.5">
                <Label htmlFor="agenda-location">Lugar</Label>
                <Input
                  id="agenda-location"
                  placeholder="Taller / dirección"
                  value={form.location}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, location: e.target.value }))
                  }
                />
              </div>
            </FormSection>

            <FormSection icon={StickyNote} title="Notas">
              <Textarea
                id="agenda-notes"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Detalles del cliente, recordatorios, condiciones especiales..."
              />
            </FormSection>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={submit} disabled={busy}>
              {editing ? "Guardar cambios" : "Crear cita"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FormSection({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {children}
    </section>
  );
}

function AppointmentCard({
  appointment,
  canDelete,
  busy,
  onEdit,
  onStart,
  onCancel,
  onNoShow,
  onComplete,
  onDelete,
  onOpenInspection,
}: {
  appointment: Appointment;
  canDelete: boolean;
  busy: boolean;
  onEdit: () => void;
  onStart: () => void;
  onCancel: () => void;
  onNoShow: () => void;
  onComplete: () => void;
  onDelete: () => void;
  onOpenInspection: (() => void) | null;
}) {
  const status = STATUS_META[appointment.status];
  const canStart =
    !appointment.inspectionId &&
    (appointment.status === "scheduled" || appointment.status === "in_progress");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">
              <span className="inline-flex items-center gap-1.5 text-foreground">
                <Clock className="h-4 w-4 text-muted-foreground" />
                {formatTime(appointment.scheduledAt)}
              </span>
            </CardTitle>
            <CardDescription className="mt-0.5">
              {formatDayLong(appointment.scheduledAt)}
            </CardDescription>
          </div>
          <Badge variant={status.tone} className="text-[10px]">
            {status.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5 text-sm">
          {appointment.plate ? (
            <div>
              <span className="inline-flex items-center rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-xs">
                {appointment.plate}
              </span>
            </div>
          ) : null}
          {appointment.ownerName && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <UserIcon className="h-3.5 w-3.5" />
              <span className="truncate">{appointment.ownerName}</span>
            </div>
          )}
          {appointment.ownerPhone && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-3.5 w-3.5" />
              <a
                href={`tel:${appointment.ownerPhone.replace(/\s/g, "")}`}
                className="hover:underline"
              >
                {appointment.ownerPhone}
              </a>
            </div>
          )}
          {appointment.location && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              <span className="truncate">{appointment.location}</span>
            </div>
          )}
          {appointment.notes && (
            <div className="rounded border-l-2 border-muted bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
              {appointment.notes}
            </div>
          )}
        </div>

        <div className={cn("flex flex-wrap items-center gap-1 border-t pt-3")}>
          {canStart && (
            <Button size="sm" onClick={onStart} disabled={busy} className="gap-1">
              <Play className="h-3.5 w-3.5" />
              Iniciar peritaje
            </Button>
          )}
          {onOpenInspection && (
            <Button size="sm" variant="outline" onClick={onOpenInspection} className="gap-1">
              <CalendarClock className="h-3.5 w-3.5" />
              Abrir peritaje
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onEdit} className="gap-1">
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </Button>
          {appointment.status === "scheduled" && (
            <>
              <Button size="sm" variant="ghost" onClick={onCancel} className="gap-1 text-muted-foreground">
                <X className="h-3.5 w-3.5" />
                Cancelar
              </Button>
              <Button size="sm" variant="ghost" onClick={onNoShow} className="gap-1 text-muted-foreground">
                No vino
              </Button>
            </>
          )}
          {appointment.status === "in_progress" && (
            <Button size="sm" variant="ghost" onClick={onComplete} className="gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Marcar completada
            </Button>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onDelete}
              className="ml-auto gap-1 text-danger hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const WEEKDAYS_ES = ["L", "M", "X", "J", "V", "S", "D"];
const MONTH_NAMES_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function CalendarView({
  monthAnchor,
  setMonthAnchor,
  selectedDay,
  setSelectedDay,
  appointments,
  onCardEdit,
  onCardStart,
  onCardCancel,
  onCardNoShow,
  onCardComplete,
  onCardDelete,
  onCardOpenInspection,
  canDelete,
  busy,
}: {
  monthAnchor: Date;
  setMonthAnchor: (d: Date) => void;
  selectedDay: Date;
  setSelectedDay: (d: Date) => void;
  appointments: Appointment[];
  onCardEdit: (a: Appointment) => void;
  onCardStart: (a: Appointment) => void;
  onCardCancel: (a: Appointment) => void;
  onCardNoShow: (a: Appointment) => void;
  onCardComplete: (a: Appointment) => void;
  onCardDelete: (a: Appointment) => void;
  onCardOpenInspection: (a: Appointment) => void;
  canDelete: (a: Appointment) => boolean;
  busy: boolean;
}) {
  // Agrupamos citas por día (clave YYYY-MM-DD) para acceso O(1) al pintar la grilla.
  const byDay = React.useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const k = dayKey(new Date(a.scheduledAt));
      const arr = m.get(k);
      if (arr) arr.push(a);
      else m.set(k, [a]);
    }
    for (const arr of m.values()) {
      arr.sort((x, y) => (x.scheduledAt < y.scheduledAt ? -1 : 1));
    }
    return m;
  }, [appointments]);

  // Construimos la grilla del mes empezando en lunes. Rellenamos con días del
  // mes anterior y siguiente hasta cubrir 6 filas (42 celdas) — así la altura
  // es siempre estable, no salta cuando cambia el mes.
  const cells = React.useMemo(() => {
    const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
    const dow = (first.getDay() + 6) % 7; // 0 = Mon, 6 = Sun
    const start = new Date(first);
    start.setDate(first.getDate() - dow);
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(d);
    }
    return out;
  }, [monthAnchor]);

  const today = startOfDay(new Date());
  const selectedKey = dayKey(selectedDay);
  const selectedAppts = byDay.get(selectedKey) ?? [];

  function shiftMonth(delta: number) {
    const d = new Date(monthAnchor);
    d.setMonth(d.getMonth() + delta);
    setMonthAnchor(d);
  }

  function goToToday() {
    const t = startOfDay(new Date());
    setSelectedDay(t);
    const m = new Date(t);
    m.setDate(1);
    setMonthAnchor(m);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => shiftMonth(-1)}
                aria-label="Mes anterior"
                className="h-8 w-8"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <CardTitle className="text-base">
                {MONTH_NAMES_ES[monthAnchor.getMonth()]} {monthAnchor.getFullYear()}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => shiftMonth(1)}
                aria-label="Mes siguiente"
                className="h-8 w-8"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={goToToday}>
              Hoy
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded border bg-border text-center text-[11px]">
            {WEEKDAYS_ES.map((w) => (
              <div key={w} className="bg-muted/60 py-1.5 font-semibold uppercase tracking-wider text-muted-foreground">
                {w}
              </div>
            ))}
            {cells.map((d) => {
              const k = dayKey(d);
              const inMonth = d.getMonth() === monthAnchor.getMonth();
              const isToday = d.getTime() === today.getTime();
              const isSelected = k === selectedKey;
              const appts = byDay.get(k) ?? [];
              return (
                <button
                  type="button"
                  key={k}
                  onClick={() => setSelectedDay(startOfDay(d))}
                  className={cn(
                    "flex min-h-[64px] flex-col items-stretch gap-1 bg-card p-1.5 text-left transition-colors hover:bg-muted/40",
                    !inMonth && "text-muted-foreground/60",
                    isSelected && "ring-2 ring-inset ring-primary",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
                        isToday && "bg-primary text-primary-foreground",
                      )}
                    >
                      {d.getDate()}
                    </span>
                    {appts.length > 0 && (
                      <span className="rounded bg-primary/10 px-1 text-[10px] font-semibold text-primary">
                        {appts.length}
                      </span>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {appts.slice(0, 2).map((a) => (
                      <div
                        key={a.id}
                        className={cn(
                          "truncate rounded px-1 text-[10px]",
                          a.status === "cancelled" || a.status === "no_show"
                            ? "bg-muted text-muted-foreground line-through"
                            : a.status === "completed"
                              ? "bg-success/15 text-success"
                              : "bg-primary/10 text-primary",
                        )}
                      >
                        {formatTime(a.scheduledAt)} {a.plate || a.ownerName || "—"}
                      </div>
                    ))}
                    {appts.length > 2 && (
                      <div className="text-[10px] text-muted-foreground">
                        +{appts.length - 2} más
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {selectedDay.toLocaleDateString("es-CO", {
              weekday: "long",
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </CardTitle>
          <CardDescription>
            {selectedAppts.length === 0
              ? "Sin citas para este día."
              : `${selectedAppts.length} cita${selectedAppts.length === 1 ? "" : "s"} programada${selectedAppts.length === 1 ? "" : "s"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {selectedAppts.map((a) => (
            <AppointmentCard
              key={a.id}
              appointment={a}
              canDelete={canDelete(a)}
              busy={busy}
              onEdit={() => onCardEdit(a)}
              onStart={() => onCardStart(a)}
              onCancel={() => onCardCancel(a)}
              onNoShow={() => onCardNoShow(a)}
              onComplete={() => onCardComplete(a)}
              onDelete={() => onCardDelete(a)}
              onOpenInspection={
                a.inspectionId ? () => onCardOpenInspection(a) : null
              }
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
