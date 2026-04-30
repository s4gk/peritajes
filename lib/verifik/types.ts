/**
 * Verifik API response types — only the fields perito actually uses.
 * Field names mirror the API exactly, including known typos (`marke`, `cilidraje`).
 */

export type VerifikSignature = { message: string; dateTime: string };

/* -----------------------------------------------------------
 *  FASECOLDA — values-by-plate
 * --------------------------------------------------------- */

export type FasecoldaValueModel = {
  modelo: string;
  valor: number;
  estado: string;
  modeloId: number;
  idEstado: number;
};

export type FasecoldaData = {
  plate: string;
  marke: string;
  line1?: string;
  line2?: string;
  line3?: string;
  homoloCode?: string;
  bcpp?: string;
  valueModel?: FasecoldaValueModel[];

  cylinderCapacity?: string;
  fuel?: string;
  power?: string;
  weight?: string;
  long?: string;
  axles?: string;
  doors?: string;
  capacityPassengers?: string;
  capacityLoad?: string;
  traction?: string;
  transmission?: string;
  typology?: string;
  service?: string;
  category?: string;
  class?: string;

  airbags?: string;
  absShow?: string;
  airconditioningShow?: string;
  typeAirConditioning?: string;
  brakes?: string;
  electricChairs?: string;
  electricGlasses?: string;
  electricMirrors?: string;
  explorersShow?: string;
  importedShow?: string;
  reverseCameraShow?: string;
  sensorsShow?: string;
  sunroofShow?: string;
  upholsteryLeatherShow?: string;
  tachometer?: string;
  typeBox?: string;
  typeAddress?: string;
  typeHeadlights?: string;
  rearSuspension?: string;
  foodSystem?: string;
};

export type FasecoldaResponse = {
  data: FasecoldaData;
  signature: VerifikSignature;
  id: string;
};

/* -----------------------------------------------------------
 *  RUNT — vehicle-by-plate
 * --------------------------------------------------------- */

export type RuntInformacionGeneral = {
  noLicenciaTransito: string;
  estadoDelVehiculo: string;
  tipoServicio: string;
  claseVehiculo: string;
  marca: string;
  linea: string;
  /** Colombian terminology: `modelo` = AÑO del vehículo, NOT make/model. */
  modelo: string;
  color: string;
  noMotor: string;
  noChasis: string;
  noVin: string;
  /** Sic — API typo for "cilindraje". */
  cilidraje: string;
  tipoCarroceria: string;
  /** DD/MM/YYYY format. */
  fechaMatricula: string;
  tieneGravamenes: string;
  organismoTransito: string;
  prendas: string;
  clasificacion: string;
  tipoCombustible: string;
  noPlaca: string;
  puertas: string;
};

export type RuntDatosTecnicos = {
  pesoBrutoVehicular: string;
  noEjes: string;
  pasajerosSentados: string;
};

export type RuntSoat = {
  noPoliza: string;
  fechaExpedicion: string;
  fechaVigencia: string;
  fechaVencimiento: string;
  entidadExpideSoat: string;
  estado: string;
  tipoTarifa: string;
};

export type RuntTecnoMecanica = {
  vigente: string;
};

export type RuntSolicitud = {
  noSolicitud: string;
  fechaSolicitud: string;
  estado: string;
  tramitesRealizados: string;
  entidad: string;
};

export type RuntData = {
  informacionGeneral: RuntInformacionGeneral;
  datosTecnicos: RuntDatosTecnicos;
  soat: RuntSoat[];
  polizasResponsabilidadCivil: unknown[];
  tecnoMecanica: RuntTecnoMecanica[];
  solicitudes: RuntSolicitud[];
};

export type RuntResponse = {
  data: RuntData;
  signature: VerifikSignature;
  id: string;
};

/* -----------------------------------------------------------
 *  Snapshot stored on the inspection
 * --------------------------------------------------------- */

export type VerifikSnapshot = {
  queriedAt: string;
  documentType?: string;
  documentNumber?: string;
  fasecolda?: FasecoldaResponse | null;
  runt?: RuntResponse | null;
};
