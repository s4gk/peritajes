/**
 * Parser de Licencia de Tránsito Colombiana (Ministerio de Transporte / RUNT)
 * a partir del texto crudo de Tesseract.js.
 *
 * El documento tiene estructura columnar fija:
 *
 *   PLACA       MARCA        LINEA        MODELO
 *   ABC123      PEUGEOT      206 XR       2003
 *
 * Estrategia:
 *  1. Tokenizamos cada línea separando por bloques de 2+ espacios. Los espacios
 *     simples ADENTRO de un valor se preservan (p.ej. "206 XR", "BLANCO BANQUISE")
 *     porque el ojo humano y Tesseract los entienden como parte del mismo dato.
 *  2. Si una línea contiene SOLO etiquetas conocidas, es un encabezado y la
 *     siguiente línea no-vacía trae los valores en el mismo orden.
 *  3. Si una línea mezcla etiquetas y valores, los pares se asignan in-line
 *     (caso típico: "LICENCIA DE TRANSITO No. 10037889711").
 *  4. Por campo aplicamos correcciones específicas (placa, dígitos, alfanumérico,
 *     enum) y validamos. Nada lanza — devolvemos lo que se pudo + warnings.
 *
 * Diseñado para tolerar OCR ruidoso: confusiones típicas como O↔0, I↔1, S↔5,
 * B↔8, Z↔2 se corrigen en el contexto correcto (no las aplicamos a fields
 * alfanuméricos como número de motor, donde una "S" puede ser legítima).
 */

// -----------------------------------------------------------------------------
// Tipos públicos
// -----------------------------------------------------------------------------

export type Servicio =
  | "PARTICULAR"
  | "PUBLICO"
  | "OFICIAL"
  | "DIPLOMATICO";

export type Combustible =
  | "GASOLINA"
  | "DIESEL"
  | "GAS"
  | "ELECTRICO"
  | "HIBRIDO";

/**
 * Datos estructurados extraídos de una Licencia de Tránsito.
 *
 * Todos los campos son opcionales — el parser nunca lanza, y si un campo no
 * aparece en el OCR (o aparece ilegible) queda como `undefined`. Reflejá eso
 * en el formulario dejando esos campos editables.
 */
export interface LicenciaTransito {
  /** No. de Licencia de Tránsito (10 dígitos) */
  licenciaTransito?: string;
  /** Placa colombiana clásica: 3 letras + 3 dígitos */
  placa?: string;
  marca?: string;
  /** Línea/modelo comercial (p.ej. "206 XR", "Corolla GLi") */
  linea?: string;
  /** Año-modelo del vehículo */
  modelo?: number;
  /** Cilindrada en cc, ya sin separadores de miles */
  cilindradaCC?: number;
  color?: string;
  servicio?: Servicio;
  claseVehiculo?: string;
  tipoCarroceria?: string;
  combustible?: Combustible;
  /** Capacidad en Kg o pasajeros según corresponda */
  capacidad?: number;
  numeroMotor?: string;
  /** Indicador de regrabado (N/S) asociado al motor */
  regMotor?: string;
  /** VIN de 17 caracteres, o `null` si la tarjeta lo trae censurado (`******`) */
  vin?: string | null;
  numeroSerie?: string;
  /** Indicador de regrabado (N/S) asociado al número de serie */
  regSerie?: string;
  numeroChasis?: string;
  /** Indicador de regrabado (N/S) asociado al chasis */
  regChasis?: string;
  /** Nombre completo del propietario */
  propietario?: string;
  /** Cédula o NIT del propietario (6–10 dígitos), sin prefijo "C.C." */
  identificacion?: string;
}

/** Resultado de un validador individual. */
export interface Validation {
  valid: boolean;
  reason?: string;
}

/** Salida principal del parser. */
export interface ParseResult {
  /** Datos extraídos y normalizados (campos pueden faltar). */
  data: LicenciaTransito;
  /** Lista de campos que están presentes pero fallaron su validador. Los
   *  campos ausentes NO generan warning (sería ruido). */
  warnings: string[];
  /** 0–1, fracción de campos del modelo (sobre 21 posibles) que están
   *  presentes Y pasaron validación. Útil como score de "qué tan limpio quedó
   *  el escaneo": <0.5 sospecho de mala foto, >0.85 confiable. */
  confidence: number;
}

// -----------------------------------------------------------------------------
// Etiquetas conocidas. El orden importa: el matching es por substring, así que
// las variantes más específicas ("CILINDRADA CC") deben ir ANTES que las
// genéricas ("CILINDRADA"). Lo mismo con "NUMERO DE MOTOR" vs cualquier otro
// "NUMERO DE …".
// -----------------------------------------------------------------------------

type FieldKey = keyof LicenciaTransito;
type LabelKey = FieldKey | "_reg";

const LABELS: Array<[string, LabelKey]> = [
  ["LICENCIA DE TRANSITO", "licenciaTransito"],
  ["CLASE DE VEHICULO", "claseVehiculo"],
  ["TIPO DE CARROCERIA", "tipoCarroceria"],
  ["TIPO CARROCERIA", "tipoCarroceria"],
  ["CARROCERIA", "tipoCarroceria"],
  ["CILINDRADA CC", "cilindradaCC"],
  ["CILINDRADA", "cilindradaCC"],
  ["CAPACIDAD KG/PSJ", "capacidad"],
  ["CAPACIDAD", "capacidad"],
  ["NUMERO DE MOTOR", "numeroMotor"],
  ["NUMERO DE SERIE", "numeroSerie"],
  ["NUMERO DE CHASIS", "numeroChasis"],
  ["PROPIETARIO", "propietario"],
  ["IDENTIFICACION", "identificacion"],
  ["COMBUSTIBLE", "combustible"],
  ["SERVICIO", "servicio"],
  ["MODELO", "modelo"],
  ["PLACA", "placa"],
  ["MARCA", "marca"],
  ["LINEA", "linea"],
  ["COLOR", "color"],
  // REG aparece 3 veces (motor, serie, chasis). Lo marcamos con un sentinel y
  // resolvemos a regMotor/regSerie/regChasis según la etiqueta a su izquierda.
  ["REG", "_reg"],
  ["VIN", "vin"],
];

/** Quita tildes y pasa a UPPER, además de mapear Ñ→N. Solo para el matching
 *  de etiquetas — los valores reales conservan acentos. */
function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[Ññ]/g, "N")
    .toUpperCase();
}

/** Encuentra el primer label cuyo texto aparezca como substring del token
 *  normalizado. Retorna `null` si ninguno matchea. */
function findLabel(token: string): LabelKey | null {
  const norm = normalizeForMatch(token);
  for (const [label, key] of LABELS) {
    if (norm.includes(label)) return key;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Tokenizer columnar
// -----------------------------------------------------------------------------

interface Token {
  text: string;
  start: number;
}

/**
 * Tokeniza una línea separando por bloques de 2+ espacios. Los espacios SIMPLES
 * dentro de un valor se preservan (p.ej. "206 XR" sigue siendo un único token,
 * "BLANCO BANQUISE" también). Esto coincide con cómo Tesseract con
 * `preserve_interword_spaces=1` mantiene la grilla del documento.
 */
function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  // \S(?:[^\s]| (?! ))* — empieza con no-espacio, sigue con (no-espacio | un
  // espacio que NO está seguido de otro espacio). Resultado: corta en 2+ spaces.
  const re = /\S(?:[^\s]| (?! ))*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    tokens.push({ text: m[0].trim(), start: m.index });
  }
  return tokens;
}

// -----------------------------------------------------------------------------
// Correcciones post-OCR
// -----------------------------------------------------------------------------

/** Convierte caracteres alfabéticos típicamente confundidos por dígitos (O→0,
 *  I/l/L→1, S→5, B→8, Z→2) y descarta cualquier no-dígito restante. Usalo solo
 *  en campos puramente numéricos. */
function digitsOnly(s: string): string {
  return s
    .replace(/[OoQq]/g, "0")
    .replace(/[IilL|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8")
    .replace(/[Zz]/g, "2")
    .replace(/[.,\s]/g, "")
    .replace(/[^0-9]/g, "");
}

/** Corrige una placa colombiana clásica (AAA000) aplicando corrección
 *  contextual: posiciones 0–2 deben ser letras (dígito→letra), posiciones 3–5
 *  deben ser dígitos (letra→dígito). */
function fixPlaca(s: string): string {
  const cleaned = s.replace(/[\s\-]/g, "").toUpperCase();
  const chars = cleaned.split("");
  for (let i = 0; i < Math.min(chars.length, 6); i++) {
    const c = chars[i];
    if (i < 3) {
      // Letra esperada — corregir dígito hacia letra similar
      if (c === "0") chars[i] = "O";
      else if (c === "1") chars[i] = "I";
      else if (c === "5") chars[i] = "S";
      else if (c === "8") chars[i] = "B";
      else if (c === "2") chars[i] = "Z";
    } else {
      // Dígito esperado — corregir letra hacia dígito similar
      if (c === "O" || c === "Q") chars[i] = "0";
      else if (c === "I" || c === "L") chars[i] = "1";
      else if (c === "S") chars[i] = "5";
      else if (c === "B") chars[i] = "8";
      else if (c === "Z") chars[i] = "2";
    }
  }
  return chars.slice(0, 6).join("");
}

/** Strippea prefijos típicos del documento ("C.C.", "C C", "NIT") y deja
 *  solo los dígitos (con correcciones de OCR). */
function fixIdentificacion(s: string): string {
  const stripped = s
    .replace(/^(C\.?\s*C\.?|NIT)[:.\s\-]*/i, "")
    .trim();
  return digitsOnly(stripped);
}

/** Quita espacios y signos, deja solo alfanumérico en mayúsculas. Para motor,
 *  serie, chasis (donde una "S" o una "I" puede ser legítima — no apliques
 *  digitsOnly acá). */
function fixAlphaNumeric(s: string): string {
  return s.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

/** Normaliza el VIN. Devuelve `null` si el OCR trajo asteriscos (campo
 *  censurado en la tarjeta) o si después de limpiar quedó con menos de 17
 *  caracteres válidos (no hay forma de inferir el resto). */
function fixVIN(s: string): string | null {
  const raw = s.replace(/\s/g, "").toUpperCase();
  if (raw === "" || /^\*+$/.test(raw)) return null;
  const alphanum = raw.replace(/[^A-Z0-9]/g, "");
  if (alphanum.length < 17) return null;
  return alphanum.slice(0, 17);
}

/** Limpia texto libre: conserva letras (incluido ñ y vocales con tilde),
 *  dígitos, espacios y signos comunes. Colapsa espacios y pasa a UPPER. */
function fixFreeText(s: string): string {
  return s
    .replace(/[^A-Za-zÑñÁÉÍÓÚáéíóúÜü0-9\s\-/.]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .toUpperCase();
}

/** Reduce el REG a una sola letra. Prefiere N o S si aparecen en el token. */
function fixReg(s: string): string {
  const letters = s.replace(/[^A-Z]/gi, "").toUpperCase();
  const ns = letters.match(/[NS]/);
  if (ns) return ns[0];
  return letters.charAt(0) || s.trim();
}

/** Mapea texto crudo al enum Servicio. */
function normalizeServicio(s: string): Servicio | undefined {
  const n = normalizeForMatch(s);
  if (/PARTICULAR/.test(n)) return "PARTICULAR";
  if (/PUBLICO/.test(n)) return "PUBLICO";
  if (/OFICIAL/.test(n)) return "OFICIAL";
  if (/DIPLOMATIC/.test(n)) return "DIPLOMATICO";
  return undefined;
}

/** Mapea texto crudo al enum Combustible. "GAS" se chequea al final porque
 *  "GASOLINA" lo contiene como substring. */
function normalizeCombustible(s: string): Combustible | undefined {
  const n = normalizeForMatch(s);
  if (/GASOLINA/.test(n)) return "GASOLINA";
  if (/DIESEL/.test(n)) return "DIESEL";
  if (/ELECTRICO/.test(n)) return "ELECTRICO";
  if (/HIBRIDO/.test(n)) return "HIBRIDO";
  if (/\bGAS\b|GNV|GLP|GAS\s*NATURAL/.test(n)) return "GAS";
  return undefined;
}

/**
 * Corrige el carácter prohibido del VIN ISO-3779 (I, O, Q) mapeándolo al
 * dígito correspondiente. Exportado porque el OCR client lo usa en una
 * segunda pasada de refinamiento con whitelist VIN.
 */
export function correctVinForbiddenChars(token: string): string {
  return token
    .toUpperCase()
    .replace(/\s/g, "")
    .replace(/[IL|]/g, "1")
    .replace(/[OQ]/g, "0");
}

// -----------------------------------------------------------------------------
// Validadores — uno por campo. Cumplen la firma { valid, reason? }.
// -----------------------------------------------------------------------------

export function validateLicenciaTransito(s: string | undefined): Validation {
  if (!s) return { valid: false, reason: "ausente" };
  if (!/^[0-9]{10}$/.test(s)) {
    return { valid: false, reason: `debe tener 10 dígitos (got "${s}")` };
  }
  return { valid: true };
}

export function validatePlaca(s: string | undefined): Validation {
  if (!s) return { valid: false, reason: "ausente" };
  if (!/^[A-Z]{3}[0-9]{3}$/.test(s)) {
    return { valid: false, reason: `formato inválido (got "${s}")` };
  }
  return { valid: true };
}

export function validateModelo(n: number | undefined): Validation {
  if (n == null) return { valid: false, reason: "ausente" };
  const current = new Date().getFullYear();
  if (!Number.isInteger(n) || n < 1950 || n > current + 1) {
    return {
      valid: false,
      reason: `fuera de rango [1950, ${current + 1}] (got ${n})`,
    };
  }
  return { valid: true };
}

export function validateCilindradaCC(n: number | undefined): Validation {
  if (n == null) return { valid: false, reason: "ausente" };
  if (!Number.isInteger(n) || n < 50 || n > 20000) {
    return { valid: false, reason: `fuera de rango plausible (got ${n})` };
  }
  return { valid: true };
}

export function validateCapacidad(n: number | undefined): Validation {
  if (n == null) return { valid: false, reason: "ausente" };
  if (!Number.isInteger(n) || n < 0 || n > 100000) {
    return { valid: false, reason: `fuera de rango (got ${n})` };
  }
  return { valid: true };
}

export function validateIdentificacion(s: string | undefined): Validation {
  if (!s) return { valid: false, reason: "ausente" };
  if (!/^[0-9]{6,10}$/.test(s)) {
    return { valid: false, reason: `debe tener 6–10 dígitos (got "${s}")` };
  }
  return { valid: true };
}

export function validateServicio(s: Servicio | undefined): Validation {
  if (!s) return { valid: false, reason: "ausente o no reconocido" };
  return { valid: true };
}

export function validateCombustible(s: Combustible | undefined): Validation {
  if (!s) return { valid: false, reason: "ausente o no reconocido" };
  return { valid: true };
}

export function validateVIN(s: string | null | undefined): Validation {
  if (s === undefined) return { valid: false, reason: "ausente" };
  // null es legítimo: la tarjeta puede traer ****** en el VIN.
  if (s === null) return { valid: true };
  if (s.length !== 17) {
    return { valid: false, reason: `debe tener 17 caracteres (got ${s.length})` };
  }
  if (/[IOQ]/.test(s)) {
    return { valid: false, reason: "contiene I/O/Q (caracteres prohibidos)" };
  }
  return { valid: true };
}

export function validateAlphaNumeric(s: string | undefined): Validation {
  if (!s) return { valid: false, reason: "ausente" };
  if (!/^[A-Z0-9]+$/.test(s)) {
    return { valid: false, reason: `caracteres inválidos (got "${s}")` };
  }
  return { valid: true };
}

export function validateReg(s: string | undefined): Validation {
  if (!s) return { valid: false, reason: "ausente" };
  if (!/^[A-Z]$/.test(s)) {
    return { valid: false, reason: `debe ser una sola letra (got "${s}")` };
  }
  return { valid: true };
}

export function validateFreeText(s: string | undefined): Validation {
  if (!s) return { valid: false, reason: "ausente" };
  if (s.length < 2) return { valid: false, reason: `demasiado corto ("${s}")` };
  return { valid: true };
}

const VALIDATORS: Record<FieldKey, (v: unknown) => Validation> = {
  licenciaTransito: (v) => validateLicenciaTransito(v as string | undefined),
  placa: (v) => validatePlaca(v as string | undefined),
  marca: (v) => validateFreeText(v as string | undefined),
  linea: (v) => validateFreeText(v as string | undefined),
  modelo: (v) => validateModelo(v as number | undefined),
  cilindradaCC: (v) => validateCilindradaCC(v as number | undefined),
  color: (v) => validateFreeText(v as string | undefined),
  servicio: (v) => validateServicio(v as Servicio | undefined),
  claseVehiculo: (v) => validateFreeText(v as string | undefined),
  tipoCarroceria: (v) => validateFreeText(v as string | undefined),
  combustible: (v) => validateCombustible(v as Combustible | undefined),
  capacidad: (v) => validateCapacidad(v as number | undefined),
  numeroMotor: (v) => validateAlphaNumeric(v as string | undefined),
  regMotor: (v) => validateReg(v as string | undefined),
  vin: (v) => validateVIN(v as string | null | undefined),
  numeroSerie: (v) => validateAlphaNumeric(v as string | undefined),
  regSerie: (v) => validateReg(v as string | undefined),
  numeroChasis: (v) => validateAlphaNumeric(v as string | undefined),
  regChasis: (v) => validateReg(v as string | undefined),
  propietario: (v) => validateFreeText(v as string | undefined),
  identificacion: (v) => validateIdentificacion(v as string | undefined),
};

const TOTAL_FIELDS = Object.keys(VALIDATORS).length;

// -----------------------------------------------------------------------------
// Asignación + parsing principal
// -----------------------------------------------------------------------------

function assignField(
  data: LicenciaTransito,
  key: FieldKey,
  rawValue: string,
): void {
  const v = rawValue.trim();
  if (!v) return;

  switch (key) {
    case "licenciaTransito": {
      // Strippeamos prefijos típicos que el OCR mete entre la etiqueta y el
      // número ("No.", "Nro.", "N°"). Sin esto, "No. 1003788971" → digitsOnly
      // convertía la 'o' a '0' y quedaba "01003788971" con un cero fantasma.
      const stripped = v.replace(/^N(?:O|RO|UMERO|°)\.?\s*/i, "").trim();
      data.licenciaTransito = digitsOnly(stripped);
      break;
    }
    case "placa":
      data.placa = fixPlaca(v);
      break;
    case "modelo": {
      const n = parseInt(digitsOnly(v), 10);
      if (Number.isFinite(n)) data.modelo = n;
      break;
    }
    case "cilindradaCC": {
      const n = parseInt(digitsOnly(v), 10);
      if (Number.isFinite(n)) data.cilindradaCC = n;
      break;
    }
    case "capacidad": {
      const n = parseInt(digitsOnly(v), 10);
      if (Number.isFinite(n)) data.capacidad = n;
      break;
    }
    case "identificacion":
      data.identificacion = fixIdentificacion(v);
      break;
    case "servicio":
      data.servicio = normalizeServicio(v);
      break;
    case "combustible":
      data.combustible = normalizeCombustible(v);
      break;
    case "vin":
      data.vin = fixVIN(v);
      break;
    case "numeroMotor":
    case "numeroSerie":
    case "numeroChasis":
      data[key] = fixAlphaNumeric(v);
      break;
    case "regMotor":
    case "regSerie":
    case "regChasis":
      data[key] = fixReg(v);
      break;
    case "marca":
    case "linea":
    case "color":
    case "claseVehiculo":
    case "tipoCarroceria":
    case "propietario":
      data[key] = fixFreeText(v);
      break;
  }
}

/** Convierte `_reg` en regMotor/regSerie/regChasis según la etiqueta a su
 *  izquierda en la misma fila de encabezados. */
function resolveRegs(labels: (LabelKey | null)[]): (FieldKey | null)[] {
  return labels.map((lab, idx) => {
    if (lab !== "_reg") return lab;
    for (let k = idx - 1; k >= 0; k--) {
      const prev = labels[k];
      if (prev === "numeroMotor") return "regMotor";
      if (prev === "numeroSerie") return "regSerie";
      if (prev === "numeroChasis") return "regChasis";
    }
    return null;
  });
}

/** Detecta tokens que casi seguro son ruido del OCR (signos sueltos como »,
 *  comillas exóticas, fragmentos de 1 char no-alfanuméricos). Los filtramos
 *  antes de alinear con los encabezados, sino corren el conteo y mueven los
 *  valores a la columna equivocada. */
function isJunkToken(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  // 1-2 chars compuestos solo por puntuación/símbolos → basura.
  if (t.length <= 2 && /^[^\p{L}\p{N}]+$/u.test(t)) return true;
  return false;
}

// -----------------------------------------------------------------------------
// Respaldo independiente del layout
//
// El parser columnar (text-based y espacial) depende de poder LEER las
// etiquetas (PLACA, MARCA, …) para ubicar las columnas. Cuando Tesseract lee
// los encabezados demasiado mal para matchear —o la tarjeta tiene un layout
// distinto al esperado, p.ej. la tarjeta plástica RUNT vs la hoja de papel— el
// parser devuelve CERO campos y el perito ve "no detecté datos", aunque en el
// texto crudo sí estén la placa o el VIN perfectamente legibles.
//
// Esta pasada escanea el rawText completo buscando patrones de ALTA confianza
// (forma inequívoca) sin depender de etiquetas ni columnas. Solo RELLENA campos
// que el parser dejó vacíos; nunca pisa lo ya detectado. Es estrictamente
// aditiva: en el peor caso no encuentra nada y deja el resultado igual.
//
// Deliberadamente NO inferimos acá licencia (10 dígitos, se confunde con la
// cédula) ni cilindraje/año si hay ambigüedad — preferimos dejar esos campos
// vacíos para que el perito los complete antes que meter un valor equivocado.
// -----------------------------------------------------------------------------

export function applyLayoutIndependentFallback(
  data: LicenciaTransito,
  rawText: string,
): void {
  const upper = rawText.toUpperCase();

  // --- Placa (carro AAA000 o moto AAA00A) -----------------------------------
  // Toleramos confusiones de OCR en la parte numérica; fixPlaca + validatePlaca
  // descartan cualquier match que no quede con forma de placa real. Las word
  // boundaries evitan capturar fragmentos de tokens largos (VIN, motor).
  if (!data.placa) {
    const carRe = /\b[A-Z]{3}[\s-]?[A-Z0-9]{3}\b/g;
    let m: RegExpExecArray | null;
    while ((m = carRe.exec(upper)) !== null) {
      const candidate = fixPlaca(m[0]);
      if (validatePlaca(candidate).valid) {
        data.placa = candidate;
        break;
      }
    }
  }

  // --- VIN / chasis (17 chars alfanuméricos) --------------------------------
  // data.vin === null es legítimo (tarjeta con ******): no lo pisamos. En CO el
  // VIN y el chasis suelen coincidir; si ambos faltan, rellenamos los dos con
  // el primer token válido de 17 chars (el perito verifica antes de aplicar).
  if (data.vin === undefined || !data.numeroChasis) {
    const idRe = /\b[A-Z0-9]{17}\b/g;
    let m: RegExpExecArray | null;
    while ((m = idRe.exec(upper)) !== null) {
      const candidate = correctVinForbiddenChars(m[0]);
      if (validateVIN(candidate).valid) {
        if (data.vin === undefined) data.vin = candidate;
        if (!data.numeroChasis) data.numeroChasis = candidate;
        break;
      }
    }
  }

  // --- Identificación del propietario (prefijo C.C./NIT) --------------------
  if (!data.identificacion) {
    const idMatch = upper.match(
      /\b(?:C\.?\s*C\.?|NIT)[:.\s-]*([0-9OQILSBZ.\s]{6,15})/,
    );
    if (idMatch) {
      const id = digitsOnly(idMatch[1]);
      if (validateIdentificacion(id).valid) data.identificacion = id;
    }
  }
}

/**
 * Parsea el texto crudo del OCR a un objeto estructurado + warnings + score.
 * Nunca lanza: si no puede extraer nada, devuelve `data` vacío y
 * `confidence: 0`.
 */
export function parseLicenciaTransito(rawOcrText: string): ParseResult {
  const data: LicenciaTransito = {};

  const cleaned = rawOcrText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  const lines = cleaned.split("\n").map((l) => l.replace(/\s+$/, ""));

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const tokens = tokenize(line);
    if (tokens.length === 0) {
      i++;
      continue;
    }
    const tokenLabels = tokens.map((t) => findLabel(t.text));
    const labelCount = tokenLabels.filter((l) => l !== null).length;

    if (labelCount === 0) {
      // Línea de puros valores — probablemente ya consumida como pareja del
      // header anterior. Si no, no podemos atribuirla a nada.
      i++;
      continue;
    }

    const resolvedLabels = resolveRegs(tokenLabels);

    if (labelCount >= 2) {
      // 2+ labels en la línea → es una fila de encabezados (aún si tiene algo
      // de ruido entre ellos). NO usamos labelCount === tokens.length porque
      // Tesseract suele meter tokens basura como "He", "—" o "»" entre
      // columnas y esos rompían la alineación.
      let j = i + 1;
      while (j < lines.length && tokenize(lines[j]).length === 0) j++;
      if (j >= lines.length) {
        i++;
        continue;
      }
      // Solo nos quedamos con los tokens del header que SON labels. Los
      // "intermedios" no-label son ruido y los descartamos para alinear.
      const labelOnlyKeys: FieldKey[] = [];
      for (let k = 0; k < tokens.length; k++) {
        const key = resolvedLabels[k];
        if (key) labelOnlyKeys.push(key);
      }
      // En la fila de valores, también filtramos basura (1-2 chars de pura
      // puntuación tipo "»", "—"). Sin esto, esos tokens corren el conteo y
      // mandan valores a la columna equivocada.
      const valueTokens = tokenize(lines[j]).filter(
        (vt) => !isJunkToken(vt.text),
      );

      if (
        valueTokens.length > 0 &&
        Math.abs(valueTokens.length - labelOnlyKeys.length) <= 2
      ) {
        // Conteos suficientemente parecidos: alineamos 1:1 hasta donde llegue
        // el lado más corto. Es preferible omitir un campo a asignarle el
        // valor equivocado.
        const useCount = Math.min(valueTokens.length, labelOnlyKeys.length);
        for (let k = 0; k < useCount; k++) {
          const key = labelOnlyKeys[k];
          const text = valueTokens[k].text;
          // Defensa contra label-echo (p.ej. PROPIETARIO → "Identificación"
          // cuando el OCR repite el encabezado en la fila de valores).
          if (findLabel(text) !== null) continue;
          assignField(data, key, text);
        }
      }
      // Si la diferencia es >2 (p.ej. header tiene 4, value solo 1 megatoken),
      // preferimos no asignar nada antes que meter datos cruzados — el perito
      // los puede completar a mano leyendo de la foto.
      i = j + 1;
    } else {
      // labelCount === 1 — caso "una línea: label + value(s)".
      // Ej: "LICENCIA DE TRANSITO No.    10037889711"
      for (let k = 0; k < tokens.length; k++) {
        const key = resolvedLabels[k];
        if (
          key &&
          k + 1 < tokens.length &&
          tokenLabels[k + 1] === null &&
          !isJunkToken(tokens[k + 1].text)
        ) {
          assignField(data, key, tokens[k + 1].text);
          k++; // saltamos el valor ya consumido
        }
      }
      i++;
    }
  }

  // Respaldo: si el parser columnar dejó campos clave vacíos (típico cuando el
  // OCR no pudo leer los encabezados), intentamos rescatarlos del texto crudo.
  applyLayoutIndependentFallback(data, rawOcrText);

  // --- Validación + confidence ---
  const warnings: string[] = [];
  let validCount = 0;
  for (const key of Object.keys(VALIDATORS) as FieldKey[]) {
    const value = (data as Record<string, unknown>)[key];
    const result = VALIDATORS[key](value);
    if (result.valid) {
      // Campo válido Y presente: cuenta para confidence. (validateVIN(null)
      // retorna valid pero el "null" como tal es legítimo y representa data.)
      if (value !== undefined) validCount++;
    } else if (value !== undefined) {
      // Solo emitimos warning si el campo está presente pero falló — los
      // ausentes son silenciosos, sino el array de warnings sería ruido puro.
      warnings.push(`${key}: ${result.reason}`);
    }
  }

  const confidence = validCount / TOTAL_FIELDS;
  return { data, warnings, confidence };
}

// -----------------------------------------------------------------------------
// Adapter para el formulario actual de la app (claves en inglés)
// -----------------------------------------------------------------------------

/**
 * Forma de los campos que espera el formulario de vehículo (`ExtractedFields`
 * en `components/wizard/ownership-card-scanner.tsx`). Lo declaramos acá para
 * que el adapter sea self-contained y type-safe sin depender del componente.
 */
export interface VehicleFormFields {
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
  vehicleClass?: string;
  serviceType?: string;
  cylinderCapacity?: string;
  owner?: string;
  ownerDocument?: string;
}

const FUEL_MAP: Record<Combustible, NonNullable<VehicleFormFields["fuel"]>> = {
  GASOLINA: "gasoline",
  DIESEL: "diesel",
  GAS: "gas",
  ELECTRICO: "electric",
  HIBRIDO: "hybrid",
};

// Los valores que llegan al formulario son los mismos strings de los Selects
// (BODY_TYPES, VEHICLE_CLASSES, SERVICE_OPTIONS) — TODOS EN MAYÚSCULA, igual
// que como vienen impresos en la tarjeta de propiedad colombiana.
const SERVICIO_MAP: Record<Servicio, string> = {
  PARTICULAR: "PARTICULAR",
  PUBLICO: "PÚBLICO",
  OFICIAL: "OFICIAL",
  DIPLOMATICO: "DIPLOMÁTICO",
};

/** Mapea la carrocería detectada al value del select del formulario. */
function mapBodyType(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const n = normalizeForMatch(s);
  if (/HATCH/.test(n)) return "HATCHBACK";
  if (/SEDAN/.test(n)) return "SEDÁN";
  if (/\bSUV\b/.test(n)) return "SUV";
  if (/PICK/.test(n)) return "PICKUP";
  if (/\bVAN\b/.test(n)) return "VAN";
  if (/COUPE/.test(n)) return "COUPÉ";
  if (/CONVERT/.test(n)) return "CONVERTIBLE";
  return s.toUpperCase();
}

/** Mapea la clase de vehículo al value del select del formulario. */
function mapVehicleClass(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const n = normalizeForMatch(s);
  if (/AUTOMOVIL/.test(n)) return "AUTOMÓVIL";
  if (/CAMIONETA/.test(n)) return "CAMIONETA";
  if (/CAMPERO/.test(n)) return "CAMPERO";
  if (/PICK/.test(n)) return "PICKUP";
  if (/MOTO/.test(n)) return "MOTOCICLETA";
  if (/BUSETA/.test(n)) return "BUSETA";
  if (/MICRO/.test(n)) return "MICROBÚS";
  if (/CAMION/.test(n)) return "CAMIÓN";
  if (/\bBUS\b/.test(n)) return "BUS";
  return s.toUpperCase();
}

// -----------------------------------------------------------------------------
// Detección de cara (frente vs reverso)
// -----------------------------------------------------------------------------

/** Resultado de la detección de cara de la tarjeta de propiedad. */
export type CardSide = "front" | "back" | "unknown";

/** Firmas de texto que solo aparecen en el FRENTE de la tarjeta (header
 *  oficial del Ministerio). Si vemos alguna, es frente seguro. */
const FRONT_SIGNATURES = [
  /MINISTERIO\s+DE\s+TRANSPORTE/,
  /REPUBLICA\s+DE\s+COLOMBIA/,
  /LICENCIA\s+DE\s+TRANSITO/,
];

/** Firmas típicas del REVERSO: anotaciones, observaciones, limitaciones,
 *  traspaso. La cara trasera suele no traer etiquetas estructuradas. */
const BACK_SIGNATURES = [
  /\bOBSERVACIONES\b/,
  /\bANOTACIONES\b/,
  /\bLIMITACIONES\b/,
  /\bTRASPASOS?\b/,
  /\bAUTORIDAD\s+DE\s+TRANSITO\b/,
];

/**
 * Detecta cuál cara de la licencia de tránsito está en la foto a partir del
 * texto crudo del OCR. Lógica:
 *  1. Si vemos firmas inequívocas del FRENTE (Ministerio, República, etc.) →
 *     `"front"`.
 *  2. Si NO vemos firmas del frente Y vemos firmas del reverso (OBSERVACIONES,
 *     LIMITACIONES, etc.) → `"back"`.
 *  3. Si nada matchea → `"unknown"` (foto basura, mala iluminación, etc.).
 *
 * No usa los `data.fields` parseados — opera directo sobre el rawText, para
 * que sirva incluso si el parser falló por completo.
 */
export function detectSide(rawOcrText: string): CardSide {
  const norm = normalizeForMatch(rawOcrText);
  if (FRONT_SIGNATURES.some((re) => re.test(norm))) return "front";
  if (BACK_SIGNATURES.some((re) => re.test(norm))) return "back";
  return "unknown";
}

// -----------------------------------------------------------------------------
// Parser espacial: cuando tenemos las palabras de Tesseract con sus bboxes,
// alineamos columnas por posición X real (no por texto). Esto resuelve el caso
// donde el OCR pega columnas con espacios simples (p.ej. "BPA481 PEUGEOT" o
// "HATCH BACK GASOLINA") porque alineamos cada palabra del value-row con la
// columna del header cuyo rango X la contiene.
// -----------------------------------------------------------------------------

/** Una palabra del OCR con su posición. Las coordenadas son las que devuelve
 *  Tesseract (`bbox.x0/y0/x1/y1` en píxeles de la imagen original). */
export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Una "línea" del OCR — un conjunto de palabras que comparten Y aproximada. */
export interface OcrLine {
  words: OcrWord[];
}

/** Matchea una etiqueta SOLO si aparece al inicio del token normalizado.
 *  Importante para el parser espacial: cuando juntamos palabras consecutivas
 *  (`["LÍNEA","MODELO"]` → "LINEA MODELO"), si usáramos `includes` matchearía
 *  "MODELO" y tragaríamos LÍNEA como prefijo del label MODELO, asignando mal
 *  todas las columnas. Con prefix-match, "LINEA MODELO" solo matchea "LINEA". */
function findLabelPrefix(
  token: string,
): { key: LabelKey; labelText: string } | null {
  // Strippeamos puntuación inicial tipo "“" o ":" que el OCR a veces deja.
  const cleaned = normalizeForMatch(token).replace(/^[^\p{L}\p{N}]+/u, "");
  for (const [label, key] of LABELS) {
    if (cleaned.startsWith(label)) return { key, labelText: label };
  }
  return null;
}

/** Busca etiquetas conocidas dentro de una línea, juntando palabras consecutivas
 *  (hasta 6) y reportando el rango X de la etiqueta detectada. Crece el
 *  acumulado SOLO si el label-text matcheado es estrictamente más largo —
 *  evita tragarse "MARCA" como parte de "PLACA MARCA" (ambos matchean
 *  "PLACA" como substring pero el label real son etiquetas distintas). */
function findLabelsInWords(
  words: OcrWord[],
): Array<{ label: LabelKey; x0: number; x1: number }> {
  const out: Array<{ label: LabelKey; x0: number; x1: number }> = [];
  let i = 0;
  while (i < words.length) {
    let bestKey: LabelKey | null = null;
    let bestEnd = i;
    let bestLabelLength = 0;
    for (let j = i; j < words.length && j - i < 6; j++) {
      const concat = words
        .slice(i, j + 1)
        .map((w) => w.text)
        .join(" ");
      const lab = findLabelPrefix(concat);
      if (lab && lab.labelText.length > bestLabelLength) {
        bestKey = lab.key;
        bestEnd = j;
        bestLabelLength = lab.labelText.length;
      }
    }
    if (bestKey) {
      out.push({ label: bestKey, x0: words[i].x0, x1: words[bestEnd].x1 });
      i = bestEnd + 1;
    } else {
      i++;
    }
  }
  return out;
}

/** Centro X de una palabra. */
function centerX(w: OcrWord): number {
  return (w.x0 + w.x1) / 2;
}

/**
 * Parser principal cuando tenemos las palabras con bboxes. Para cada línea
 * con etiquetas: detecta los rangos X de cada label y asigna las palabras de
 * la siguiente línea a la columna cuyo rango X las contiene. Es robusto al
 * "OCR pegó dos columnas con espacio simple" porque cada palabra individual
 * cae a su columna por su posición X real.
 */
export function parseLicenciaTransitoFromOcr(
  lines: OcrLine[],
): ParseResult {
  const data: LicenciaTransito = {};

  // Filtramos líneas sin contenido útil para no tropezar con basura.
  const useful = lines.filter((l) => l.words.some((w) => w.text.trim().length > 0));

  let i = 0;
  while (i < useful.length) {
    const line = useful[i];
    const labels = findLabelsInWords(line.words);

    if (labels.length === 0) {
      i++;
      continue;
    }

    if (labels.length === 1) {
      // Una sola etiqueta: caso "label + value en la misma línea". Lo que
      // venga DESPUÉS del rango X de la etiqueta, en la misma línea, es valor.
      const lab = labels[0];
      const valueWords = line.words.filter((w) => centerX(w) > lab.x1);
      const value = valueWords
        .map((w) => w.text)
        .join(" ")
        .trim();
      if (value && findLabel(value) === null) {
        const resolved = resolveRegs([lab.label])[0];
        if (resolved) assignField(data, resolved, value);
      }
      i++;
      continue;
    }

    // 2+ etiquetas → fila de encabezados. La siguiente línea trae los valores.
    if (i + 1 >= useful.length) {
      i++;
      continue;
    }
    const valueLine = useful[i + 1];
    const resolved = resolveRegs(labels.map((l) => l.label));

    for (let k = 0; k < labels.length; k++) {
      const key = resolved[k];
      if (!key) continue;
      const colStart = labels[k].x0;
      const colEnd = k + 1 < labels.length ? labels[k + 1].x0 : Infinity;
      // Tolerancia: aceptamos palabras cuyo centro caiga incluso un poco
      // antes del inicio de la columna (los valores muchas veces empiezan
      // medio caracter a la izquierda de la etiqueta).
      const tolerance = 10;
      const wordsInCol = valueLine.words.filter((w) => {
        const c = centerX(w);
        return c >= colStart - tolerance && c < colEnd - tolerance;
      });
      if (wordsInCol.length === 0) continue;
      const value = wordsInCol
        .map((w) => w.text)
        .join(" ")
        .trim();
      if (!value) continue;
      // Anti label-echo: si el valor coincide con una etiqueta conocida es
      // probable que el OCR repitió un header en la fila de datos.
      if (findLabel(value) !== null) continue;
      assignField(data, key, value);
    }
    i += 2;
  }

  // Respaldo independiente del layout. Reconstruimos el texto crudo a partir de
  // las palabras (una línea por OcrLine) y rescatamos placa/VIN/cédula si el
  // alineado por columnas no los detectó.
  const reconstructed = useful
    .map((l) => l.words.map((w) => w.text).join(" "))
    .join("\n");
  applyLayoutIndependentFallback(data, reconstructed);

  // Validación + confidence (mismo bloque que el parser text-based)
  const warnings: string[] = [];
  let validCount = 0;
  for (const key of Object.keys(VALIDATORS) as FieldKey[]) {
    const value = (data as Record<string, unknown>)[key];
    const result = VALIDATORS[key](value);
    if (result.valid) {
      if (value !== undefined) validCount++;
    } else if (value !== undefined) {
      warnings.push(`${key}: ${result.reason}`);
    }
  }
  return { data, warnings, confidence: validCount / TOTAL_FIELDS };
}

/**
 * Convierte el `LicenciaTransito` parseado a la forma que consume el formulario
 * de vehículo de la app (claves en inglés, enums en minúsculas, selects con
 * value en castellano con tildes). Campos sin equivalencia en el formulario
 * (regMotor, regSerie, regChasis) se descartan acá; si los necesitas, léelos
 * directo del `data` del parser.
 *
 * VIN `null` (tarjeta con `******`) se traduce a `undefined` porque el form
 * trata "campo vacío" como string vacío o undefined, no como literal null.
 */
export function toVehicleFormFields(parsed: LicenciaTransito): VehicleFormFields {
  return {
    plate: parsed.placa,
    licenseNumber: parsed.licenciaTransito,
    vin: parsed.vin ?? undefined,
    chassisNumber: parsed.numeroChasis,
    engineNumber: parsed.numeroMotor,
    // Todos los campos de texto los devolvemos en MAYÚSCULA, igual que como
    // vienen impresos en la tarjeta. fixFreeText del parser ya hace el upper,
    // así que pasamos los valores tal cual sin titleCasearlos.
    make: parsed.marca,
    model: parsed.linea,
    year: parsed.modelo?.toString(),
    color: parsed.color,
    bodyType: mapBodyType(parsed.tipoCarroceria),
    fuel: parsed.combustible ? FUEL_MAP[parsed.combustible] : undefined,
    vehicleClass: mapVehicleClass(parsed.claseVehiculo),
    serviceType: parsed.servicio ? SERVICIO_MAP[parsed.servicio] : undefined,
    cylinderCapacity: parsed.cilindradaCC?.toString(),
    owner: parsed.propietario,
    ownerDocument: parsed.identificacion,
  };
}
