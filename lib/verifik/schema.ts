import { z } from "zod";

/**
 * Zod schemas para validar respuestas de la API de Verifik. Tolerantes —
 * todos los campos internos son opcionales y permitimos extras (passthrough)
 * para que un campo nuevo del proveedor no rompa la app.
 *
 * El único hard check es la envolvente: tiene que existir `data` como objeto
 * y `id` string. Si Verifik nos manda un error renderizado como HTML, un 200
 * vacío, o un shape sorpresa, fallamos rápido en lugar de pasar undefined a
 * los mappers río abajo (que antes generaban NaN o "undefined undefined" en
 * el PDF sin alertas).
 */

const Signature = z
  .object({
    message: z.string().optional(),
    dateTime: z.string().optional(),
  })
  .passthrough();

const FasecoldaValueModel = z
  .object({
    modelo: z.string().optional(),
    valor: z.number().optional(),
    estado: z.string().optional(),
    modeloId: z.number().optional(),
    idEstado: z.number().optional(),
  })
  .passthrough();

const FasecoldaData = z
  .object({
    plate: z.string().optional(),
    marke: z.string().optional(),
    valueModel: z.array(FasecoldaValueModel).optional(),
  })
  .passthrough();

export const FasecoldaResponseSchema = z
  .object({
    data: FasecoldaData,
    signature: Signature.optional(),
    id: z.string().optional(),
  })
  .passthrough();

const RuntInformacionGeneral = z
  .object({
    noLicenciaTransito: z.string().optional(),
    estadoDelVehiculo: z.string().optional(),
    marca: z.string().optional(),
    linea: z.string().optional(),
    modelo: z.string().optional(),
    color: z.string().optional(),
    noMotor: z.string().optional(),
    noChasis: z.string().optional(),
    noVin: z.string().optional(),
    cilidraje: z.string().optional(),
    tipoCarroceria: z.string().optional(),
    fechaMatricula: z.string().optional(),
    tipoCombustible: z.string().optional(),
    noPlaca: z.string().optional(),
  })
  .passthrough();

const RuntData = z
  .object({
    informacionGeneral: RuntInformacionGeneral.optional(),
    datosTecnicos: z.record(z.unknown()).optional(),
    soat: z.array(z.unknown()).optional(),
    tecnoMecanica: z.array(z.unknown()).optional(),
    solicitudes: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const RuntResponseSchema = z
  .object({
    data: RuntData,
    signature: Signature.optional(),
    id: z.string().optional(),
  })
  .passthrough();
