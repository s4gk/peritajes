/**
 * Definición de los pasos del tour de uso, adaptados por rol. Los `target` que
 * apuntan a `[data-tour="..."]` deben coincidir con los `tourId` que
 * components/panel/sidebar.tsx pone en cada item del menú. El builder solo
 * incluye pasos cuyo objetivo existe en el DOM para ese rol (el sidebar ya
 * filtra los items por rol con visibleFor()).
 */

export type Placement = "top" | "bottom" | "left" | "right" | "auto";

export type TourStep = {
  id: string;
  /** Selector CSS del elemento a resaltar, o "center" para un paso centrado sin foco. */
  target: string;
  title: string;
  body: string;
  placement?: Placement;
  /** Abrir el drawer del sidebar (en móvil) antes de medir este paso. */
  requiresDrawer?: boolean;
};

export type TourRole = "admin" | "owner" | "employee";

const WELCOME: TourStep = {
  id: "welcome",
  target: "center",
  title: "¡Bienvenido a Peritajes del Llano!",
  body: "Te mostramos en 1 minuto cómo moverte por la plataforma. Puedes saltar este recorrido cuando quieras.",
};

const DASHBOARD: TourStep = {
  id: "dashboard",
  target: '[data-tour="dashboard"]',
  title: "Dashboard",
  body: "Tu resumen del negocio: peritajes, actividad y métricas clave.",
  placement: "right",
  requiresDrawer: true,
};

const AGENDA: TourStep = {
  id: "agenda",
  target: '[data-tour="agenda"]',
  title: "Agenda",
  body: "Consulta y organiza tus citas de peritaje día a día.",
  placement: "right",
  requiresDrawer: true,
};

const PERITAJES: TourStep = {
  id: "peritajes",
  target: '[data-tour="peritajes"]',
  title: "Peritajes",
  body: "Crea, edita y revisa el estado de cada peritaje. Funciona también sin conexión en campo.",
  placement: "right",
  requiresDrawer: true,
};

const VEHICULOS: TourStep = {
  id: "vehiculos",
  target: '[data-tour="vehiculos"]',
  title: "Vehículos",
  body: "Registro de los vehículos peritados y su historial.",
  placement: "right",
  requiresDrawer: true,
};

const PROPIETARIOS: TourStep = {
  id: "propietarios",
  target: '[data-tour="propietarios"]',
  title: "Propietarios",
  body: "Datos de contacto de los dueños de los vehículos.",
  placement: "right",
  requiresDrawer: true,
};

const EMPRESA: TourStep = {
  id: "empresa",
  target: '[data-tour="empresa"]',
  title: "Empresa",
  body: "Configura los datos de tu empresa: logo, NIT y la información que sale en los informes.",
  placement: "right",
  requiresDrawer: true,
};

const EMPLEADOS: TourStep = {
  id: "empleados",
  target: '[data-tour="empleados"]',
  title: "Empleados",
  body: "Crea las cuentas de tu equipo y define qué puede ver y hacer cada uno.",
  placement: "right",
  requiresDrawer: true,
};

const WHATSAPP: TourStep = {
  id: "whatsapp",
  target: '[data-tour="whatsapp"]',
  title: "WhatsApp",
  body: "Envía los informes y notificaciones a tus clientes por WhatsApp.",
  placement: "right",
  requiresDrawer: true,
};

const CUENTA: TourStep = {
  id: "cuenta",
  target: '[data-tour="cuenta"]',
  title: "Mi cuenta",
  body: "Actualiza tu firma, tus datos y tu contraseña.",
  placement: "right",
  requiresDrawer: true,
};

const HELP: TourStep = {
  id: "help",
  target: '[data-tour="help"]',
  title: "¿Necesitas verlo de nuevo?",
  body: "Pulsa este botón de ayuda en cualquier momento para repetir el recorrido.",
  placement: "bottom",
};

const DONE: TourStep = {
  id: "done",
  target: "center",
  title: "¡Listo!",
  body: "Ya conoces lo esencial. ¡A trabajar!",
};

export function buildSteps(role: TourRole): TourStep[] {
  const steps: TourStep[] = [WELCOME];

  // Dashboard lo ven owner y admin (employee no tiene el item).
  if (role === "owner" || role === "admin") steps.push(DASHBOARD);

  steps.push(AGENDA, PERITAJES, VEHICULOS, PROPIETARIOS);

  // Sección de gestión del negocio: solo el dueño.
  if (role === "owner") steps.push(EMPRESA, EMPLEADOS, WHATSAPP);

  steps.push(CUENTA, HELP, DONE);
  return steps;
}

/* -------------------------------------------------------------------------- *
 * Paso a paso dentro de cada sección.
 *
 * A diferencia del recorrido general (que solo resalta el menú), estos pasos
 * apuntan a controles reales de la página actual, así que NO necesitan abrir el
 * drawer. Los `data-tour` aquí usan prefijos propios (dash-, per-, etc.) para no
 * chocar con los del sidebar. El orquestador salta cualquier paso cuyo objetivo
 * no esté visible (p. ej. el buscador no se muestra si no hay registros).
 * -------------------------------------------------------------------------- */

const DASHBOARD_TOUR: TourStep[] = [
  {
    id: "dash-intro",
    target: "center",
    title: "Tu tablero",
    body: "Aquí ves el resumen de tu operación de un vistazo.",
  },
  {
    id: "dash-metrics",
    target: '[data-tour="dash-metrics"]',
    title: "Indicadores clave",
    body: "Peritajes de este mes, total acumulado y cuántos salieron con riesgo alto.",
    placement: "bottom",
  },
  {
    id: "dash-trend",
    target: '[data-tour="dash-trend"]',
    title: "Tendencia mensual",
    body: "Cómo evoluciona tu volumen de peritajes en los últimos 6 meses.",
    placement: "top",
  },
  {
    id: "dash-recent",
    target: '[data-tour="dash-recent"]',
    title: "Actividad reciente",
    body: "Tus últimos peritajes; toca cualquiera para abrirlo.",
    placement: "top",
  },
  {
    id: "dash-new",
    target: '[data-tour="dash-new"]',
    title: "Crear un peritaje",
    body: "Inicia un peritaje nuevo desde aquí en cualquier momento.",
    placement: "bottom",
  },
];

const PERITAJES_TOUR: TourStep[] = [
  {
    id: "per-intro",
    target: "center",
    title: "Tus peritajes",
    body: "Este es el listado de todos tus peritajes. Funciona también sin conexión.",
  },
  {
    id: "per-new",
    target: '[data-tour="per-new"]',
    title: "Nuevo peritaje",
    body: "Crea un peritaje desde cero con este botón.",
    placement: "bottom",
  },
  {
    id: "per-search",
    target: '[data-tour="per-search"]',
    title: "Buscar y filtrar",
    body: "Encuentra un peritaje por placa, VIN, propietario o rango de fechas.",
    placement: "bottom",
  },
  {
    id: "per-list",
    target: '[data-tour="per-list"]',
    title: "Cada peritaje",
    body: "Toca una tarjeta para abrirlo; también puedes descargar su PDF o duplicarlo.",
    placement: "top",
  },
];

const AGENDA_TOUR: TourStep[] = [
  {
    id: "agenda-intro",
    target: "center",
    title: "Tu agenda",
    body: "Organiza las citas de peritaje día a día.",
  },
  {
    id: "agenda-view",
    target: '[data-tour="agenda-view"]',
    title: "Lista o calendario",
    body: "Cambia entre ver tus citas como lista o en el calendario.",
    placement: "bottom",
  },
  {
    id: "agenda-new",
    target: '[data-tour="agenda-new"]',
    title: "Nueva cita",
    body: "Agenda una cita nueva con su fecha, hora y los datos del cliente.",
    placement: "bottom",
  },
];

const VEHICULOS_TOUR: TourStep[] = [
  {
    id: "veh-intro",
    target: "center",
    title: "Vehículos",
    body: "El histórico de todos los vehículos que has peritado.",
  },
  {
    id: "veh-search",
    target: '[data-tour="veh-search"]',
    title: "Buscar vehículo",
    body: "Filtra por placa, marca, modelo o VIN.",
    placement: "bottom",
  },
];

const PROPIETARIOS_TOUR: TourStep[] = [
  {
    id: "prop-intro",
    target: "center",
    title: "Propietarios",
    body: "Tu cartera de dueños; se actualiza sola con cada peritaje que guardas.",
  },
  {
    id: "prop-search",
    target: '[data-tour="prop-search"]',
    title: "Buscar propietario",
    body: "Filtra por nombre, documento o teléfono.",
    placement: "bottom",
  },
];

const INTAKE_TOUR: TourStep[] = [
  {
    id: "intake-intro",
    target: "center",
    title: "Nuevo peritaje",
    body: "En dos pasos defines qué vas a peritar.",
  },
  {
    id: "intake-type",
    target: '[data-tour="intake-type"]',
    title: "1. Tipo de vehículo",
    body: "Elige el tipo de vehículo a inspeccionar.",
    placement: "bottom",
  },
  {
    id: "intake-kind",
    target: '[data-tour="intake-kind"]',
    title: "2. Tipo de peritaje",
    body: "Completo, rápido o avalúo: cada uno define las secciones del peritaje.",
    placement: "top",
  },
  {
    id: "intake-start",
    target: '[data-tour="intake-start"]',
    title: "Iniciar",
    body: "Cuando elijas ambos, inícialo y llena los datos dentro del peritaje.",
    placement: "top",
  },
];

/** Recorridos por ruta. La clave (prefijo de pathname) se usa también como id
 *  de almacenamiento ("section:<ruta>") para auto-lanzarlos una sola vez. */
const SECTION_TOURS: Array<{ path: string; steps: TourStep[] }> = [
  { path: "/dashboard", steps: DASHBOARD_TOUR },
  { path: "/peritajes", steps: PERITAJES_TOUR },
  { path: "/agenda", steps: AGENDA_TOUR },
  { path: "/vehiculos", steps: VEHICULOS_TOUR },
  { path: "/propietarios", steps: PROPIETARIOS_TOUR },
  { path: "/intake", steps: INTAKE_TOUR },
];

export type SectionTour = { key: string; steps: TourStep[] };

/** Devuelve el paso a paso de la sección correspondiente al pathname, o null si
 *  esa ruta no tiene recorrido propio. */
export function getSectionTour(pathname: string): SectionTour | null {
  const match = SECTION_TOURS.find(
    (s) => pathname === s.path || pathname.startsWith(`${s.path}/`),
  );
  if (!match) return null;
  return { key: `section:${match.path}`, steps: match.steps };
}
