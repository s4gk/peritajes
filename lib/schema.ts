import { z } from "zod";

export const vehicleSchema = z.object({
  plate: z.string().min(1, "Placa requerida"),
  vin: z.string().optional().default(""),
  make: z.string().min(1, "Marca requerida"),
  model: z.string().min(1, "Modelo requerido"),
  year: z
    .string()
    .regex(/^\d{4}$/u, "Año inválido")
    .refine((v) => {
      const n = Number(v);
      return n >= 1950 && n <= new Date().getFullYear() + 1;
    }, "Año fuera de rango"),
  color: z.string().optional().default(""),
  mileage: z.string().regex(/^\d+$/u, "Kilometraje inválido"),
  fuel: z.enum(["gasoline", "diesel", "hybrid", "electric", "gas", ""]),
  transmission: z.enum(["manual", "automatic", "cvt", "dct", ""]),
  bodyType: z.string().optional().default(""),
  owner: z.string().optional().default(""),
  inspector: z.string().min(1, "Nombre del perito requerido"),
  inspectorId: z.string().optional().default(""),
  location: z.string().optional().default(""),
  date: z.string().min(1, "Fecha requerida"),
});

export const tiresSchema = z.object({
  frontLeft: z.number().min(0).max(100),
  frontRight: z.number().min(0).max(100),
  rearLeft: z.number().min(0).max(100),
  rearRight: z.number().min(0).max(100),
  spare: z.number().min(0).max(100),
  notes: z.string().optional(),
});
