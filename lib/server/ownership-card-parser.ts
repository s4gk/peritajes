/**
 * Parser de texto crudo de Tesseract → campos estructurados de la tarjeta de
 * propiedad colombiana (formato RUNT). Lógica pura, sin server-only, para que
 * pueda testearse aislada del wrapper de Tesseract.
 */

export type ExtractedOwnershipCard = {
  plate?: string;
  licenseNumber?: string;
  vin?: string;
  chassisNumber?: string;
  engineNumber?: string;
  make?: string;
  model?: string;
  year?: string;
  color?: string;
  bodyType?: string;
  fuel?: "gasoline" | "diesel" | "hybrid" | "electric" | "gas";
  transmission?: "manual" | "automatic" | "cvt" | "dct";
  vehicleClass?: string;
  nationality?: string;
  serviceType?: string;
  cylinderCapacity?: string;
  owner?: string;
};

type FieldKey = keyof ExtractedOwnershipCard;

// Normaliza para búsquedas tolerantes: quita tildes, mayúsculas, ñ→N.
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[Ññ]/g, "N")
    .toUpperCase();
}

// Etiquetas conocidas de la tarjeta RUNT, en orden de especificidad.
// La primera que matchee gana, así evitamos que "MODELO" capture lo que
// debería ser "MODELO COMERCIAL".
const LABELS: Array<[RegExp, FieldKey]> = [
  [/N(?:UMERO|°|RO\.?|O\.?)?\s+DE\s+IDENTIFICACION\s+VEHICULAR(?:\s*\(?\s*VIN\s*\)?)?/, "vin"],
  [/N(?:UMERO|°|RO\.?|O\.?)?\s+DE\s+SERIE/, "vin"],
  [/\bVIN\b/, "vin"],
  [/N(?:UMERO|°|RO\.?|O\.?)?\s+DEL?\s+MOTOR/, "engineNumber"],
  [/N(?:UMERO|°|RO\.?|O\.?)?\s+DE\s+CHASIS/, "chassisNumber"],
  [/\bCHASIS\b/, "chassisNumber"],
  [/(?:N(?:UMERO|°|RO\.?|O\.?)?\s+DE\s+)?LICENCIA(?:\s+DE\s+TRANSITO)?/, "licenseNumber"],
  [/\bPLACA\b/, "plate"],
  [/MODELO\s+COMERCIAL/, "model"],
  [/TIPO\s+DE\s+CARROCERIA/, "bodyType"],
  [/\bCARROCERIA\b/, "bodyType"],
  [/CLASE\s+DE\s+VEHICULO/, "vehicleClass"],
  [/\bCLASE\b/, "vehicleClass"],
  [/\bMARCA\b/, "make"],
  [/\bLINEA\b/, "model"],
  [/\bMODELO\b/, "year"],
  [/\bAÑO\b|\bANO\s+MODELO\b/, "year"],
  [/\bCOLOR\b/, "color"],
  [/CILINDRAJE(?:\s*\(?\s*CC\s*\)?)?/, "cylinderCapacity"],
  [/\bSERVICIO\b/, "serviceType"],
  [/\bNACIONALIDAD\b/, "nationality"],
  [/\bPROPIETARIO\b/, "owner"],
  [/\bCOMBUSTIBLE\b/, "fuel"],
];

export function parseOwnershipCardText(rawText: string): ExtractedOwnershipCard {
  const text = normalize(rawText);
  const out: ExtractedOwnershipCard = {};

  // En la tarjeta de propiedad muchas etiquetas conviven en la misma línea
  // ("MARCA TOYOTA   COLOR ROJO"). Por eso por cada línea encontramos TODAS
  // las etiquetas presentes, las ordenamos por posición, y el valor de cada
  // una es lo que va entre el final de su match y el inicio del siguiente.
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    type Hit = { field: FieldKey; start: number; end: number };
    const hits: Hit[] = [];
    for (const [pattern, field] of LABELS) {
      const global = new RegExp(pattern.source, pattern.flags + "g");
      let m: RegExpExecArray | null;
      while ((m = global.exec(line)) !== null) {
        hits.push({ field, start: m.index, end: m.index + m[0].length });
      }
    }
    hits.sort((a, b) => a.start - b.start);

    // Eliminamos solapamientos (p.ej. "CHASIS" matcheó dentro de "NUMERO DE
    // CHASIS"): nos quedamos con el match que empezó antes; descartamos los
    // que empiezan dentro de otro.
    const dedup: Hit[] = [];
    for (const h of hits) {
      const prev = dedup[dedup.length - 1];
      if (prev && h.start < prev.end) continue;
      dedup.push(h);
    }

    for (let i = 0; i < dedup.length; i++) {
      const hit = dedup[i];
      if (out[hit.field] != null) continue;
      const next = dedup[i + 1];
      const valueEnd = next ? next.start : line.length;
      const raw = line.slice(hit.end, valueEnd).replace(/^[\s:.\-]+/, "").trim();
      if (!raw) continue;
      const value = extractFieldValue(hit.field, raw);
      if (value != null) {
        (out as Record<FieldKey, unknown>)[hit.field] = value;
      }
    }
  }

  // Fallbacks globales: si la etiqueta no se detectó pero el patrón del valor
  // es inequívoco (VIN tiene 17 chars, placa tiene formato fijo), lo sacamos
  // del texto entero.
  if (!out.vin) {
    const m = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
    if (m) out.vin = m[0];
  }
  if (!out.plate) {
    const m = text.match(/\b([A-Z]{3})\s?(\d{2}[A-Z\d])\b/);
    if (m) out.plate = (m[1] + m[2]).toUpperCase();
  }

  return out;
}

function extractFieldValue(field: FieldKey, raw: string): unknown {
  switch (field) {
    case "plate": {
      const m = raw.match(/([A-Z]{3})\s?(\d{2}[A-Z\d])/);
      return m ? m[1] + m[2] : undefined;
    }
    case "licenseNumber": {
      const m = raw.match(/\d{4,}/);
      return m ? m[0] : undefined;
    }
    case "vin": {
      const m = raw.match(/[A-HJ-NPR-Z0-9]{17}/);
      if (m) return m[0];
      // Algunos OCR confunden 0/O y 1/I — si vemos algo de longitud 17 con
      // letras prohibidas, lo dejamos pasar igual: el perito lo corrige.
      const m2 = raw.match(/[A-Z0-9]{17}/);
      return m2 ? m2[0] : undefined;
    }
    case "chassisNumber":
    case "engineNumber": {
      const m = raw.match(/[A-Z0-9][A-Z0-9-]{4,}/);
      return m ? m[0] : undefined;
    }
    case "year": {
      const m = raw.match(/\b(19|20)\d{2}\b/);
      return m ? m[0] : undefined;
    }
    case "cylinderCapacity": {
      const m = raw.match(/\d{2,5}/);
      return m ? m[0] : undefined;
    }
    case "fuel": {
      if (/GASOLINA/.test(raw)) return "gasoline";
      if (/DIESEL/.test(raw)) return "diesel";
      if (/HIBRIDO/.test(raw)) return "hybrid";
      if (/ELECTRICO/.test(raw)) return "electric";
      if (/\bGAS\b|GNV|GLP/.test(raw)) return "gas";
      return undefined;
    }
    case "make":
    case "model":
    case "color":
    case "bodyType":
    case "vehicleClass":
    case "serviceType":
    case "nationality":
    case "owner":
      return titleCase(cleanText(raw));
    default:
      return undefined;
  }
}

// Recorta cosas tipo "TOYOTA   J 1234" donde después del valor real Tesseract
// dejó basura: el valor real es lo que va hasta el primer doble espacio o
// patrón "letra. " que sugiera el inicio de otra etiqueta no listada.
function cleanText(s: string): string {
  const cut = s.split(/\s{2,}|\s+[A-Z]\.\s+/)[0];
  return cut.replace(/[^A-Z0-9 ÑÁÉÍÓÚÜ.\-/&,]/gi, "").trim();
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+|[-/])/)
    .map((part) =>
      /^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part,
    )
    .join("")
    .trim();
}
