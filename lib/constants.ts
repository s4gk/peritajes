import type { InspectionSectionDef } from "./types";

export const WIZARD_STEPS = [
  { id: "vehicle", label: "Vehículo", short: "Datos" },
  { id: "bodywork", label: "Carrocería", short: "Carrocería" },
  { id: "chassis", label: "Chasis", short: "Chasis" },
  { id: "suspension", label: "Suspensión", short: "Suspensión" },
  { id: "tires", label: "Llantas", short: "Llantas" },
  { id: "engine", label: "Motor", short: "Motor" },
  { id: "electrical", label: "Sistema eléctrico", short: "Eléctrico" },
  { id: "leaks", label: "Fugas", short: "Fugas" },
  { id: "comfort", label: "Confort e interior", short: "Confort" },
  { id: "roadTest", label: "Prueba de ruta", short: "Ruta" },
  { id: "accessories", label: "Accesorios", short: "Accesorios" },
  { id: "summary", label: "Resumen y conclusión", short: "Resumen" },
] as const;

export type StepId = (typeof WIZARD_STEPS)[number]["id"];

export const BODYWORK_SECTION: InspectionSectionDef = {
  id: "bodywork",
  label: "Carrocería",
  groups: [
    {
      id: "front",
      label: "Parte delantera",
      items: [
        { id: "bumper_front", label: "Paragolpes delantero", kind: "bodywork" },
        { id: "hood", label: "Capó", kind: "bodywork" },
        { id: "fender_fl", label: "Guardabarros delantero izquierdo", kind: "bodywork" },
        { id: "fender_fr", label: "Guardabarros delantero derecho", kind: "bodywork" },
        { id: "grille", label: "Parrilla", kind: "bodywork" },
        { id: "headlight_l", label: "Faro izquierdo", kind: "bodywork" },
        { id: "headlight_r", label: "Faro derecho", kind: "bodywork" },
      ],
    },
    {
      id: "sides",
      label: "Laterales",
      items: [
        { id: "door_fl", label: "Puerta delantera izquierda", kind: "bodywork" },
        { id: "door_fr", label: "Puerta delantera derecha", kind: "bodywork" },
        { id: "door_rl", label: "Puerta trasera izquierda", kind: "bodywork" },
        { id: "door_rr", label: "Puerta trasera derecha", kind: "bodywork" },
        { id: "rocker_l", label: "Estribo izquierdo", kind: "bodywork" },
        { id: "rocker_r", label: "Estribo derecho", kind: "bodywork" },
        { id: "mirror_l", label: "Espejo izquierdo", kind: "bodywork" },
        { id: "mirror_r", label: "Espejo derecho", kind: "bodywork" },
      ],
    },
    {
      id: "rear",
      label: "Parte trasera",
      items: [
        { id: "bumper_rear", label: "Paragolpes trasero", kind: "bodywork" },
        { id: "trunk", label: "Baúl / portón", kind: "bodywork" },
        { id: "quarter_l", label: "Panel trasero izquierdo", kind: "bodywork" },
        { id: "quarter_r", label: "Panel trasero derecho", kind: "bodywork" },
        { id: "taillight_l", label: "Stop izquierdo", kind: "bodywork" },
        { id: "taillight_r", label: "Stop derecho", kind: "bodywork" },
      ],
    },
    {
      id: "roof_glass",
      label: "Techo y vidrios",
      items: [
        { id: "roof", label: "Techo", kind: "bodywork" },
        { id: "windshield", label: "Parabrisas", kind: "bodywork" },
        { id: "rear_window", label: "Vidrio trasero", kind: "bodywork" },
        { id: "sunroof", label: "Techo corredizo", kind: "bodywork" },
      ],
    },
  ],
};

export const CHASSIS_SECTION: InspectionSectionDef = {
  id: "chassis",
  label: "Chasis y estructura",
  groups: [
    {
      id: "structure",
      label: "Estructura",
      items: [
        { id: "front_rails", label: "Largueros delanteros", kind: "structural" },
        { id: "rear_rails", label: "Largueros traseros", kind: "structural" },
        { id: "firewall", label: "Mampara / cortafuego", kind: "structural" },
        { id: "floor", label: "Piso de carrocería", kind: "structural" },
        { id: "pillar_a", label: "Parante A", kind: "structural" },
        { id: "pillar_b", label: "Parante B", kind: "structural" },
        { id: "pillar_c", label: "Parante C", kind: "structural" },
        { id: "crossmembers", label: "Travesaños", kind: "structural" },
        { id: "welds", label: "Soldaduras originales", kind: "structural" },
      ],
    },
  ],
};

export const SUSPENSION_SECTION: InspectionSectionDef = {
  id: "suspension",
  label: "Suspensión delantera y dirección",
  groups: [
    {
      id: "suspension",
      label: "Suspensión",
      items: [
        { id: "shocks_front", label: "Amortiguadores delanteros", kind: "mechanical" },
        { id: "springs_front", label: "Resortes delanteros", kind: "mechanical" },
        { id: "control_arms", label: "Tijeras / brazos de control", kind: "mechanical" },
        { id: "ball_joints", label: "Rótulas", kind: "mechanical" },
        { id: "bushings", label: "Bujes", kind: "mechanical" },
        { id: "stabilizer", label: "Barra estabilizadora", kind: "mechanical" },
      ],
    },
    {
      id: "steering",
      label: "Dirección",
      items: [
        { id: "steering_rack", label: "Cremallera", kind: "mechanical" },
        { id: "tie_rods", label: "Terminales de dirección", kind: "mechanical" },
        { id: "power_steering", label: "Bomba de dirección", kind: "mechanical" },
        { id: "steering_column", label: "Columna de dirección", kind: "mechanical" },
        { id: "alignment", label: "Alineación", kind: "mechanical" },
      ],
    },
  ],
};

export const ENGINE_SECTION: InspectionSectionDef = {
  id: "engine",
  label: "Motor",
  groups: [
    {
      id: "performance",
      label: "Desempeño",
      items: [
        { id: "idle", label: "Marcha mínima (ralentí)", kind: "mechanical" },
        { id: "acceleration", label: "Aceleración", kind: "mechanical" },
        { id: "noise", label: "Ruidos anormales", kind: "mechanical" },
        { id: "smoke", label: "Humo de escape", kind: "mechanical" },
        { id: "temperature", label: "Temperatura de operación", kind: "mechanical" },
      ],
    },
    {
      id: "components",
      label: "Componentes",
      items: [
        { id: "belts", label: "Correas", kind: "mechanical" },
        { id: "hoses", label: "Mangueras", kind: "mechanical" },
        { id: "battery", label: "Batería", kind: "mechanical" },
        { id: "air_filter", label: "Filtro de aire", kind: "mechanical" },
        { id: "spark_plugs", label: "Bujías", kind: "mechanical" },
        { id: "engine_mounts", label: "Soportes de motor", kind: "mechanical" },
      ],
    },
    {
      id: "transmission",
      label: "Transmisión",
      items: [
        { id: "clutch", label: "Embrague", kind: "mechanical" },
        { id: "gearbox", label: "Caja de cambios", kind: "mechanical" },
        { id: "driveshaft", label: "Cardán / palieres", kind: "mechanical" },
      ],
    },
  ],
};

export const ELECTRICAL_SECTION: InspectionSectionDef = {
  id: "electrical",
  label: "Sistema eléctrico",
  groups: [
    {
      id: "lights",
      label: "Luces",
      items: [
        { id: "headlights", label: "Luces delanteras", kind: "mechanical" },
        { id: "taillights", label: "Luces traseras", kind: "mechanical" },
        { id: "turn_signals", label: "Direccionales", kind: "mechanical" },
        { id: "brake_lights", label: "Luces de freno", kind: "mechanical" },
        { id: "reverse_lights", label: "Luces de reversa", kind: "mechanical" },
        { id: "interior_lights", label: "Luces interiores", kind: "mechanical" },
      ],
    },
    {
      id: "electronics",
      label: "Electrónica",
      items: [
        { id: "dashboard", label: "Tablero / indicadores", kind: "mechanical" },
        { id: "warning_lights", label: "Testigos de advertencia", kind: "mechanical" },
        { id: "wipers", label: "Limpiaparabrisas", kind: "mechanical" },
        { id: "horn", label: "Pito / bocina", kind: "mechanical" },
        { id: "power_windows", label: "Vidrios eléctricos", kind: "mechanical" },
        { id: "central_locking", label: "Cierre centralizado", kind: "mechanical" },
        { id: "alarm", label: "Alarma", kind: "mechanical" },
      ],
    },
  ],
};

export const LEAKS_SECTION: InspectionSectionDef = {
  id: "leaks",
  label: "Fugas de fluidos",
  groups: [
    {
      id: "fluids",
      label: "Fluidos",
      items: [
        { id: "engine_oil", label: "Aceite de motor", kind: "leak" },
        { id: "transmission_oil", label: "Aceite de transmisión", kind: "leak" },
        { id: "coolant", label: "Refrigerante", kind: "leak" },
        { id: "brake_fluid", label: "Líquido de frenos", kind: "leak" },
        { id: "power_steering_fluid", label: "Líquido de dirección", kind: "leak" },
        { id: "differential", label: "Aceite de diferencial", kind: "leak" },
        { id: "fuel", label: "Combustible", kind: "leak" },
      ],
    },
  ],
};

export const COMFORT_SECTION: InspectionSectionDef = {
  id: "comfort",
  label: "Confort e interior",
  groups: [
    {
      id: "ac_climate",
      label: "Aire acondicionado y clima",
      items: [
        { id: "ac_cooling", label: "Enfriamiento A/C", kind: "mechanical" },
        { id: "ac_heater", label: "Calefacción", kind: "mechanical" },
        { id: "ac_blower", label: "Ventilador", kind: "mechanical" },
        { id: "defroster", label: "Desempañador", kind: "mechanical" },
      ],
    },
    {
      id: "interior",
      label: "Interior",
      items: [
        { id: "seats", label: "Asientos y tapicería", kind: "mechanical" },
        { id: "seatbelts", label: "Cinturones de seguridad", kind: "mechanical" },
        { id: "door_panels", label: "Paneles de puertas", kind: "mechanical" },
        { id: "dash_condition", label: "Tablero y guarniciones", kind: "mechanical" },
        { id: "carpet", label: "Alfombra / piso interior", kind: "mechanical" },
        { id: "headliner", label: "Techo interior", kind: "mechanical" },
      ],
    },
    {
      id: "infotainment",
      label: "Infoentretenimiento",
      items: [
        { id: "radio", label: "Radio / pantalla", kind: "mechanical" },
        { id: "speakers", label: "Parlantes", kind: "mechanical" },
        { id: "bluetooth", label: "Bluetooth / conectividad", kind: "mechanical" },
        { id: "backup_camera", label: "Cámara de reversa", kind: "mechanical" },
      ],
    },
  ],
};

export const ROAD_TEST_SECTION: InspectionSectionDef = {
  id: "roadTest",
  label: "Prueba de ruta",
  groups: [
    {
      id: "drive",
      label: "Conducción",
      items: [
        { id: "start", label: "Arranque en frío", kind: "road_test" },
        { id: "acceleration", label: "Aceleración y respuesta", kind: "road_test" },
        { id: "shifting", label: "Cambios de marcha", kind: "road_test" },
        { id: "braking", label: "Sistema de frenos", kind: "road_test" },
        { id: "handling", label: "Estabilidad y manejo", kind: "road_test" },
        { id: "steering_feel", label: "Comportamiento de dirección", kind: "road_test" },
        { id: "suspension_feel", label: "Respuesta de suspensión", kind: "road_test" },
        { id: "noise_on_road", label: "Ruidos en ruta", kind: "road_test" },
        { id: "abs_traction", label: "ABS / control de tracción", kind: "road_test" },
      ],
    },
  ],
};

export const ALL_SECTIONS: InspectionSectionDef[] = [
  BODYWORK_SECTION,
  CHASSIS_SECTION,
  SUSPENSION_SECTION,
  ENGINE_SECTION,
  ELECTRICAL_SECTION,
  LEAKS_SECTION,
  COMFORT_SECTION,
  ROAD_TEST_SECTION,
];
