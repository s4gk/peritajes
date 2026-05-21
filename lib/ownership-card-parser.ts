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
  /** Documento o NIT del propietario (cuando aparece en la tarjeta — algunas
   *  tarjetas de propiedad lo imprimen, otras no). */
  ownerDocument?: string;
  /** "Original" | "Duplicado" — extraído del campo "TIPO DE LICENCIA" o
   *  "TIPO DE TARJETA" que viene impreso en la tarjeta de propiedad. */
  propertyCardStatus?: "Original" | "Duplicado";
};

// "__ignore" es un sentinel para "labels estructurales" — etiquetas que
// queremos detectar en la fila de headers para que el bucketing por columnas
// sepa cuántas columnas hay (y dónde caen los midpoints), pero cuyo valor NO
// debe asignarse a ningún campo. Ejemplo: "CAPACIDAD KG/PSJ" en el row con
// CLASE/TIPO/COMBUSTIBLE → si no la detectamos, el último valor (cantidad de
// pasajeros) se cuela en COMBUSTIBLE.
type FieldKey = keyof ExtractedOwnershipCard | "__ignore";

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
// OJO importante: en los patrones multi-palabra de abajo usamos `\s{1,4}` (no
// `\s+`). El `\s+` greedy era ambiguo porque cuando un layout tiene columnas
// separadas con muchos espacios — p.ej. "TIPO         CARROCERIA" como dos
// headers de columna — `\s+` los fusionaba en un sólo label gigante. Con
// `\s{1,4}` el límite máximo de 4 espacios deja que se matcheen como frase
// pegada ("TIPO DE CARROCERIA") pero no como columnas separadas.
const LABELS: Array<[RegExp, FieldKey]> = [
  [/N(?:UMERO|°|RO\.?|O\.?)?\s{1,4}DE\s{1,4}IDENTIFICACION\s{1,4}VEHICULAR(?:\s*\(?\s*VIN\s*\)?)?/, "vin"],
  [/N(?:UMERO|°|RO\.?|O\.?)?\s{1,4}DE\s{1,4}SERIE/, "vin"],
  [/\bVIN\b/, "vin"],
  [/N(?:UMERO|°|RO\.?|O\.?)?\s{1,4}DEL?\s{1,4}MOTOR/, "engineNumber"],
  [/N(?:UMERO|°|RO\.?|O\.?)?\s{1,4}DE\s{1,4}CHASIS/, "chassisNumber"],
  [/\bCHASIS\b/, "chassisNumber"],
  // "TIPO DE LICENCIA" / "TIPO DE TARJETA" → original o duplicado.
  // Va ANTES que el match genérico de LICENCIA para no comerse el valor.
  // OJO: no usamos "TARJETA DE PROPIEDAD" porque es el título del documento
  // y matchearía sin valor real al lado.
  [/TIPO\s{1,4}DE\s{1,4}(?:LICENCIA|TARJETA)/, "propertyCardStatus"],
  [/(?:N(?:UMERO|°|RO\.?|O\.?)?\s{1,4}DE\s{1,4})?LICENCIA(?:\s{1,4}DE\s{1,4}TRANSITO)?/, "licenseNumber"],
  // Placa con varios prefijos comunes: "PLACA", "No. PLACA", "PLACA VEHICULO".
  [/\bPLACA(?:\s{1,4}VEHICULO)?\b/, "plate"],
  [/MODELO\s{1,4}COMERCIAL/, "model"],
  // Algunas tarjetas omiten "DE" entre TIPO y CARROCERIA → aceptamos las dos
  // formas. Por eso también lo unimos con el alias "TIPO DE VEHICULO".
  [/TIPO\s{1,4}(?:DE\s{1,4})?CARROCERIA/, "bodyType"],
  // Algunas tarjetas (versiones recientes RUNT) usan "TIPO DE VEHICULO" en vez
  // de "TIPO DE CARROCERIA". Mismo significado funcional para el peritaje:
  // sedán, hatchback, etc. Va a bodyType (vehicleClass ya lo cubre CLASE).
  [/TIPO\s{1,4}DE\s{1,4}VEHICULO/, "bodyType"],
  [/\bCARROCERIA\b/, "bodyType"],
  [/CLASE\s{1,4}DE\s{1,4}VEHICULO/, "vehicleClass"],
  [/\bCLASE\b/, "vehicleClass"],
  [/\bMARCA\b/, "make"],
  [/\bLINEA\b/, "model"],
  [/\bMODELO\b/, "year"],
  [/\bAÑO\b|\bANO\s{1,4}MODELO\b/, "year"],
  [/\bCOLOR\b/, "color"],
  // Aceptamos "CILINDRAJE" y "CILINDRADA" — las dos formas aparecen en
  // tarjetas según la versión RUNT. El sufijo (CC) puede o no estar presente.
  [/CILINDRA(?:JE|DA)(?:\s*\(?\s*CC\s*\)?)?/, "cylinderCapacity"],
  // "TIPO DE SERVICIO" / "SERVICIO" — el primero matchea más específico.
  [/TIPO\s{1,4}DE\s{1,4}SERVICIO/, "serviceType"],
  [/\bSERVICIO\b/, "serviceType"],
  [/\bNACIONALIDAD\b/, "nationality"],
  // Documento del propietario suele venir DESPUES del nombre, en la misma
  // línea: "PROPIETARIO PEPITO PEREZ C.C. 1020456789". El parser ordena hits
  // por posición y le da a cada uno el texto hasta el siguiente, así que con
  // detectar "C.C." / "NIT" como label, el valor (los dígitos) se atribuye
  // correctamente a ownerDocument y "PROPIETARIO" se queda con el nombre.
  [/\bPROPIETARIO\b/, "owner"],
  [/\bC\s*\.?\s*C\s*\.?(?=\s)|N(?:UMERO|°|RO\.?|O\.?)?\s{1,4}(?:DE\s{1,4})?DOCUMENTO|\bN\s*I\s*T\b/, "ownerDocument"],
  [/\bCOMBUSTIBLE\b/, "fuel"],
  // Caja / transmisión — algunas tarjetas (especialmente importados con
  // homologación) traen este campo extra.
  [/TIPO\s{1,4}DE\s{1,4}CAJA|\bTRANSMISION\b|\bCAJA\b/, "transmission"],
  // Etiquetas estructurales. Se detectan para que el bucketing por columnas
  // sepa que hay N columnas en la fila, pero su valor NO se asigna a ningún
  // campo del extracto (no son datos del vehículo o del perito, son metadata
  // del template).
  //   CAPACIDAD KG/PSJ — número de pasajeros o capacidad de carga
  //   REG — flag "Regrabado" (S/N) al lado de cada número (motor, vin, chasis)
  //   FECHA EXPEDICION / FECHA VENCIMIENTO — fechas de la tarjeta
  [/\bCAPACIDAD\b/, "__ignore"],
  [/\bREG\b/, "__ignore"],
  [/FECHA\s{1,4}(?:DE\s{1,4})?(?:EXPEDICION|VENCIMIENTO)/, "__ignore"],
  // Fallback al final: si en la tarjeta hay un "TIPO" solo (sin "DE …") como
  // header de columna, lo mapeamos a bodyType. Los patrones específicos de
  // "TIPO DE LICENCIA/CARROCERIA/SERVICIO/CAJA/VEHICULO" están más arriba y
  // matchean primero, así que este sólo se activa cuando es realmente TIPO
  // suelto — caso común en tarjetas con layout de dos filas.
  [/\bTIPO\b/, "bodyType"],
];

// Palabras en mayúsculas que aparecen como FRAGMENTOS de etiqueta dentro de
// la tarjeta. Se usan para detectar layouts de dos filas: cuando el "valor"
// extraído de la misma línea es una de estas palabras, asumimos que en
// realidad es otra etiqueta (no un valor) y miramos la línea de abajo.
const LABEL_FRAGMENTS = new Set<string>([
  "TIPO", "CLASE", "MARCA", "LINEA", "COLOR", "MODELO", "ANO",
  "CARROCERIA", "COMBUSTIBLE", "NACIONALIDAD", "SERVICIO", "NUMERO",
  "MOTOR", "SERIE", "CHASIS", "VIN", "PROPIETARIO", "PLACA", "LICENCIA",
  "CILINDRAJE", "CILINDRADA", "FECHA", "EXPEDICION", "VENCIMIENTO",
  "ORGANISMO", "TRANSITO", "VEHICULO", "VEHICULAR", "IDENTIFICACION",
  "CAJA", "TARJETA", "TRANSMISION", "APELLIDO", "APELLIDOS", "NOMBRE",
  "NOMBRES", "RAZON", "SOCIAL", "DOCUMENTO", "CEDULA", "NIT", "DE",
  // Headers extra que algunas tarjetas listan como 4ta columna o flags al
  // costado de los IDs. No son fields del peritaje pero SÍ son texto que el
  // OCR captura.
  "CAPACIDAD", "KG", "PSJ", "PASAJEROS", "CARGA", "REG", "REPUBLICA",
  "COLOMBIA", "MINISTERIO", "TRANSPORTE",
]);

function isLabelFragment(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Letra suelta o letra+punto: tarjetas RUNT usan "P.", "Q.", "R." como
  // marcadores de campo, y al recortar entre dos hits pueden quedar sueltos.
  if (/^[A-Z]\.?$/.test(t)) return true;
  // Caso típico: una sola palabra mayúsculas (p.ej. "TIPO", "CARROCERIA").
  if (/^[A-Z]{2,}$/.test(t) && LABEL_FRAGMENTS.has(t)) return true;
  // Combinación de dos palabras de header (p.ej. "TIPO CARROCERIA",
  // "DE VEHICULO", "CAPACIDAD KG/PSJ"): si todas las palabras son fragmentos
  // conocidos, sigue siendo un header, no un valor real. Split por espacios
  // Y barras (slashes) porque "KG/PSJ" debe contar como 2 fragmentos, no 1.
  const words = t.split(/[\s/]+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 4) {
    if (words.every((w) => LABEL_FRAGMENTS.has(w))) return true;
  }
  return false;
}

/**
 * Tokeniza una línea word-by-word (split por uno o más espacios), preservando
 * la columna de inicio de cada token. A diferencia de `tokenizeColumns`, esta
 * versión NO requiere 2+ espacios como separador, por lo que captura valores
 * que el OCR comprimió ("BPA481 PEUGEOT" → ["BPA481", "PEUGEOT"]).
 */
function tokenizeWords(line: string): { text: string; start: number }[] {
  const tokens: { text: string; start: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    tokens.push({ text: m[0], start: m.index });
  }
  return tokens;
}

// Tokens "ruido" que aparecen entre valores reales en las tarjetas RUNT y
// que NO son parte del valor del campo. "REG" es el header de "Regrabado";
// las "N"/"S" sueltas son las marcas de regrabado (No/Sí). Los "—", "»", etc
// son artefactos OCR de las líneas decorativas del template. Si dejamos esto
// pasar al bucketing, contamina la distribución de columnas y termina en el
// campo equivocado.
const NOISE_TOKEN = /^(?:REG|N[.\-—]?|S[.\-—]?|[—»="\-_]{1,3})$/;

/**
 * Distribuye los words de la línea de abajo entre cada hit de la línea de
 * arriba, usando ESCALADO LINEAL para compensar el drift de columnas que mete
 * el OCR. El primer y último label se alinean con el primer y último word,
 * y el resto se reparte por midpoints entre columnas vecinas.
 *
 * Ejemplo: header  "PLACA(0)  MARCA(16)  LINEA(46)  MODELO(77)"
 *          valores "BPA481(0) PEUGEOT(7) 206 XR(31..35) 2003(57)"
 *          → PLACA="BPA481", MARCA="PEUGEOT", LINEA="206 XR", MODELO="2003"
 *
 * El scale = headerSpan / valueSpan acomoda el caso típico donde la fila de
 * valores está más comprimida (fuente más estrecha, menos kerning) y los
 * tokens drift hacia la izquierda relativo a su label.
 */
function distributeBelowByColumn(
  hitStarts: number[],
  nextLine: string,
): string[] {
  const allWords = tokenizeWords(nextLine);
  // Filtramos tokens de ruido (REG flags, single-letter N/S, líneas de adorno)
  // ANTES del escalado: si dejan basura intermedia, distorsionan el alineamiento.
  const words = allWords.filter((w) => !NOISE_TOKEN.test(w.text));
  if (hitStarts.length === 0) return [];
  if (words.length === 0) return hitStarts.map(() => "");
  if (hitStarts.length === 1) {
    // Un solo label: tomamos la línea entera como valor.
    return [words.map((w) => w.text).join(" ")];
  }

  const firstLabel = hitStarts[0];
  const lastLabel = hitStarts[hitStarts.length - 1];
  const firstWord = words[0].start;
  const lastWord = words[words.length - 1].start;
  const headerSpan = lastLabel - firstLabel;
  const valueSpan = lastWord - firstWord;
  const scale = headerSpan > 0 && valueSpan > 0 ? headerSpan / valueSpan : 1;

  // Midpoints entre labels consecutivos definen las fronteras de columna.
  const midpoints: number[] = [-Infinity];
  for (let i = 1; i < hitStarts.length; i++) {
    midpoints.push((hitStarts[i - 1] + hitStarts[i]) / 2);
  }
  midpoints.push(Infinity);

  const buckets: string[][] = hitStarts.map(() => []);
  for (const w of words) {
    const normalized = firstLabel + (w.start - firstWord) * scale;
    for (let i = 0; i < hitStarts.length; i++) {
      if (normalized >= midpoints[i] && normalized < midpoints[i + 1]) {
        buckets[i].push(w.text);
        break;
      }
    }
  }
  return buckets.map((b) => b.join(" "));
}

/**
 * Tokeniza una línea respetando "columnas" — toma cada chunk de chars no
 * separados por 2+ espacios como un token, con su posición de inicio en la
 * línea original. Le permite al parser alinear valores con su label cuando
 * label y valor viven en filas separadas (layout de dos filas).
 */
function tokenizeColumns(line: string): { text: string; start: number }[] {
  const tokens: { text: string; start: number }[] = [];
  const re = /\S(?:\S|\s(?!\s))*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    tokens.push({ text: m[0], start: m.index });
  }
  return tokens;
}

/**
 * Dado el inicio de columna de un hit y el inicio del siguiente hit en la
 * MISMA fila, encuentra los tokens en la línea SIGUIENTE cuya columna cae en
 * el mismo rango (con un poco de tolerancia para drift del OCR). Devuelve los
 * tokens unidos por espacio simple — preserva valores multi-palabra como
 * "SERVICIO PUBLICO".
 */
function alignedColumnValue(
  nextLine: string,
  hitStart: number,
  nextHitStart: number | undefined,
): string | null {
  if (!nextLine) return null;
  const tokens = tokenizeColumns(nextLine);
  if (tokens.length === 0) return null;
  // Tolerancia mayor cerca del borde izquierdo (los letter-prefix tipo "P. "
  // pueden mover la columna del label unos chars).
  const tol = 6;
  const endCol = nextHitStart ?? nextLine.length;
  const inRange = tokens.filter(
    (t) => t.start >= hitStart - tol && t.start < endCol,
  );
  if (inRange.length === 0) return null;
  return inRange.map((t) => t.text).join(" ");
}

export function parseOwnershipCardText(rawText: string): ExtractedOwnershipCard {
  const text = normalize(rawText);
  const out: ExtractedOwnershipCard = {};

  // En la tarjeta de propiedad muchas etiquetas conviven en la misma línea
  // ("MARCA TOYOTA   COLOR ROJO"). Por eso por cada línea encontramos TODAS
  // las etiquetas presentes, las ordenamos por posición, y el valor de cada
  // una es lo que va entre el final de su match y el inicio del siguiente.
  //
  // OJO: usamos trimEnd (no trim) para preservar el whitespace inicial. Eso
  // mantiene la alineación de columnas entre líneas consecutivas, necesaria
  // para el lookup de dos-filas (label arriba / valor abajo).
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
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

    // Pre-cómputo: ¿todos los slots entre hits están vacíos o son fragmentos
    // de label? Si sí, asumimos que ESTA fila es solo headers y la siguiente
    // es de valores → usamos distribución escalada por columna en vez del
    // per-hit lookup. Mucho más robusto cuando el OCR pega/separa tokens.
    const slotsRaw: string[] = dedup.map((h, i) => {
      const nx = dedup[i + 1];
      const end = nx ? nx.start : line.length;
      return line
        .slice(h.end, end)
        .replace(/^[\s:.\-]+/, "")
        .replace(/^[A-Z]\.\s*/, "")
        .trim();
    });
    const allSlotsEmpty =
      dedup.length >= 2 &&
      slotsRaw.every((r) => !r || isLabelFragment(r));
    const nextLineForBulk = lines[li + 1];
    if (allSlotsEmpty && nextLineForBulk) {
      const distributed = distributeBelowByColumn(
        dedup.map((h) => h.start),
        nextLineForBulk,
      );
      for (let i = 0; i < dedup.length; i++) {
        const hit = dedup[i];
        if (hit.field === "__ignore") continue;
        if (out[hit.field as keyof ExtractedOwnershipCard] != null) continue;
        const raw = distributed[i]?.trim();
        if (!raw) continue;
        if (isLabelFragment(raw)) continue;
        // Si el bucket cayó sobre otro header (porque la línea de abajo no
        // era valores sino un sub-header), no lo usamos.
        if (LABELS.some(([p]) => p.test(raw))) continue;
        const value = extractFieldValue(hit.field as keyof ExtractedOwnershipCard, raw);
        if (value != null) {
          (out as Record<string, unknown>)[hit.field] = value;
        }
      }
      continue;
    }

    for (let i = 0; i < dedup.length; i++) {
      const hit = dedup[i];
      if (hit.field === "__ignore") continue;
      if (out[hit.field as keyof ExtractedOwnershipCard] != null) continue;
      const next = dedup[i + 1];
      const valueEnd = next ? next.start : line.length;
      let raw = line.slice(hit.end, valueEnd)
        .replace(/^[\s:.\-]+/, "")
        // Tarjetas RUNT prefijan cada campo con "X." (P. CLASE, Q. TIPO, R.
        // CARROCERIA…). Si al cortar entre dos hits queda sólo ese prefijo,
        // significa que el valor real está en otra parte (típicamente en la
        // línea de abajo). Lo eliminamos para que la lógica de dos filas
        // detecte el slot como vacío y haga el lookup.
        .replace(/^[A-Z]\.\s*/, "")
        .trim();

      // Layout RUNT del propietario: a veces el OCR rinde
      //   PROPIETARIO
      //   APELLIDO(S) Y NOMBRE(S)
      //   GARCIA CASTAÑEDA SANTIAGO ANDRES   1.020.456.789
      // Sin lookahead, capturábamos el sub-rótulo como nombre. Si el valor
      // empieza con APELLIDO/NOMBRE/RAZON (o está vacío), primero intentamos
      // strippear el sub-rótulo de la misma línea; si no queda nada útil,
      // bajamos a las siguientes líneas buscando una que parezca un nombre
      // real (no sea otro label de la tarjeta).
      if (hit.field === "owner" && (!raw || /^(APELLIDO|NOMBRE|RAZON)/.test(raw))) {
        const stripped = raw
          .replace(
            /^(APELLIDO\(?S?\)?(?:\s*Y\s*NOMBRE\(?S?\)?)?|NOMBRE\(?S?\)?|RAZON\s+SOCIAL)\s*[:.\-]?\s*/,
            "",
          )
          // Después del sub-header del nombre, varias tarjetas listan al
          // costado el header "IDENTIFICACION" / "DOCUMENTO" / "CEDULA" (que
          // refieren al doc del propietario, columna de la derecha). Los
          // quitamos del residuo para que no se cuelen como parte del nombre.
          .replace(/\b(IDENTIFICACION|DOCUMENTO|CEDULA|NIT)\b/g, "")
          .replace(/\s{2,}/g, " ")
          .trim();
        // Aceptamos `stripped` como nombre sólo si contiene al menos una
        // palabra "no-fragmento" — i.e., algo que no sea otro header de la
        // tarjeta. Antes bastaba con que tuviera 3+ chars en mayúsculas, lo
        // que aceptaba "IDENTIFICACION" como nombre (claramente mal).
        const nonFragmentWords = stripped
          .split(/\s+/)
          .filter((w) => w.length >= 3 && !LABEL_FRAGMENTS.has(w));
        if (stripped && nonFragmentWords.length > 0) {
          raw = stripped;
        } else {
          raw = "";
          for (let lj = li + 1; lj < Math.min(lines.length, li + 4); lj++) {
            const candidate = lines[lj]?.trim() ?? "";
            if (!candidate) continue;
            if (/^(APELLIDO|NOMBRE|RAZON|PROPIETARIO|DIRECCION|TELEFONO|CEDULA|DOCUMENTO|NIT)/.test(candidate)) continue;
            // OJO: solo descartamos si el INICIO de la línea es un label
            // (sub-header de otro campo). Si el label está al medio o al
            // final (caso típico: nombre + "C.C. 12345678"), la línea
            // sigue siendo el nombre del propietario.
            const head = candidate.slice(0, 25);
            if (LABELS.some(([p]) => p.test(head))) continue;
            if (/[A-Z]{3,}/.test(candidate)) {
              raw = candidate;
              break;
            }
          }
        }
      }

      // Layout dos-filas: en muchas tarjetas RUNT los labels viven en una fila
      // y los valores en la siguiente, alineados por columna:
      //     CLASE         TIPO          CARROCERIA
      //     AUTOMOVIL     SEDAN         OTRO
      // Si el "valor" en la misma línea quedó vacío o parece un fragmento de
      // label (TIPO, CARROCERIA, etc), miramos la línea de abajo en el mismo
      // rango de columnas. La tolerancia de 6 cubre drift del OCR + prefijos
      // tipo "P.". No corre para owner porque ya tiene su propia lógica de
      // multi-line arriba que es más permisiva (no exige alineación).
      if (
        hit.field !== "owner" &&
        (!raw || isLabelFragment(raw))
      ) {
        const nextLine = lines[li + 1];
        if (nextLine) {
          const aligned = alignedColumnValue(
            nextLine,
            hit.start,
            next ? next.start : undefined,
          );
          if (
            aligned &&
            !isLabelFragment(aligned) &&
            // Si el token alineado abajo también es un label (header de otra
            // fila o continuación), no lo usamos.
            !LABELS.some(([p]) => p.test(aligned))
          ) {
            raw = aligned;
          }
        }
      }

      let value: unknown = null;
      if (raw) {
        value = extractFieldValue(hit.field as keyof ExtractedOwnershipCard, raw);
      }
      // Si la slot misma-línea tenía contenido pero `extractFieldValue` no
      // logró sacarle un valor válido (típico: chasis se cae porque el slot
      // estaba contaminado con "E ETICA" o "REG"), intentamos también la
      // línea de abajo. Sin este fallback, los IDs largos en layout 4-cols
      // con REG entre ellos quedaban sin asignar.
      if (value == null && hit.field !== "owner") {
        const nextLine = lines[li + 1];
        if (nextLine) {
          const aligned = alignedColumnValue(
            nextLine,
            hit.start,
            next ? next.start : undefined,
          );
          if (
            aligned &&
            !isLabelFragment(aligned) &&
            !LABELS.some(([p]) => p.test(aligned))
          ) {
            value = extractFieldValue(
              hit.field as keyof ExtractedOwnershipCard,
              aligned,
            );
          }
        }
      }
      if (value != null) {
        (out as Record<string, unknown>)[hit.field] = value;
      }
    }
  }

  // Fallbacks globales: si la etiqueta no se detectó pero el patrón del valor
  // es inequívoco (VIN tiene 17 chars, placa tiene formato fijo), lo sacamos
  // del texto entero.
  if (!out.vin) {
    const m = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
    if (m) {
      out.vin = m[0];
    } else {
      // Mismo fallback que en el extractor con etiqueta: si encontramos algo
      // de 17 chars con I/O/Q (prohibidos en VIN), los corregimos y aceptamos.
      const m2 = text.match(/\b[A-Z0-9]{17}\b/);
      if (m2) out.vin = correctVinForbiddenChars(m2[0]);
    }
  }
  if (!out.plate) {
    // Placa colombiana: AAA-123 (vieja), AAA-12B (nueva, vehículo eléctrico/
    // híbrido) o motos AAA-12B. Aceptamos espacio, guion o nada entre letras y
    // números.
    const m = text.match(/\b([A-Z]{3})[\s-]?(\d{2}[A-Z\d])\b/);
    if (m) out.plate = (m[1] + m[2]).toUpperCase();
  }
  // Si tenemos VIN pero no chasis, asumimos que son iguales (en la mayoría de
  // tarjetas RUNT coinciden). El perito puede sobreescribir si difieren.
  if (out.vin && !out.chassisNumber) {
    out.chassisNumber = out.vin;
  }

  return out;
}

function extractFieldValue(field: keyof ExtractedOwnershipCard, raw: string): unknown {
  switch (field) {
    case "plate": {
      // Aceptamos guion/espacio entre letras y números (ABC-123, ABC 123).
      const m = raw.match(/([A-Z]{3})[\s-]?(\d{2}[A-Z\d])/);
      return m ? m[1] + m[2] : undefined;
    }
    case "licenseNumber": {
      // OCR a veces parte el número con 1-2 espacios espurios entre dígitos
      // (típico con licencias RUNT de 8-11 dígitos). Aceptamos hasta 3 runs
      // separados por máx 2 espacios y los pegamos. No usamos raw.replace(/\D/g)
      // porque arrastraría dígitos de un campo vecino si el detector de labels
      // falló (ej. FECHA pegada al número).
      const m = raw.match(/\d{2,}(?:\s{1,2}\d+){0,3}/);
      if (!m) return undefined;
      const compact = m[0].replace(/\s+/g, "");
      return compact.length >= 4 ? compact : undefined;
    }
    case "vin": {
      const m = raw.match(/[A-HJ-NPR-Z0-9]{17}/);
      if (m) return correctVinForbiddenChars(m[0]);
      // Algunos OCR confunden 0/O y 1/I — si vemos algo de longitud 17 con
      // letras prohibidas, las corregimos automáticamente (I→1, O→0, Q→0)
      // porque ISO 3779 prohíbe esas letras en VINs. Para 8↔B y similares
      // que son ambiguos en formato sólido, no hay corrección automática
      // posible — queda para que el perito edite en el diálogo.
      const m2 = raw.match(/[A-Z0-9]{17}/);
      return m2 ? correctVinForbiddenChars(m2[0]) : undefined;
    }
    case "chassisNumber":
    case "engineNumber": {
      // Mínimo 8 chars: chasis y motores reales tienen al menos esa longitud
      // (los VINs ISO post-1981 son 17). Antes el límite era 5, lo que dejaba
      // que pedazos de "REGRABADO" mal OCR'd ("ETICA") fueran tomados como
      // chasis válido. Si la slot misma-línea no llega a 8 chars, devolvemos
      // null para que el caller dispare el fallback al row de valores abajo.
      const m = raw.match(/\b[A-Z0-9][A-Z0-9-]{7,}\b/);
      if (!m) return undefined;
      // Si el match parece un VIN (17 chars), aplicamos la misma corrección
      // de caracteres prohibidos. En el resto de los casos el chasis/motor
      // puede contener I/O/Q legítimamente (no son VINs ISO).
      const v = m[0];
      return v.length === 17 ? correctVinForbiddenChars(v) : v;
    }
    case "year": {
      // Antes: solo \d{4}. Algunas tarjetas imprimen "2.018" (separador de
      // miles) → strippeamos puntos/comas entre dígitos antes de matchear.
      const stripped = raw.replace(/(\d)[.,](\d)/g, "$1$2");
      const m = stripped.match(/\b(19|20)\d{2}\b/);
      return m ? m[0] : undefined;
    }
    case "cylinderCapacity": {
      // Mismo tratamiento que year: "1.800" o "1,800" → 1800.
      const stripped = raw.replace(/(\d)[.,](\d)/g, "$1$2");
      const m = stripped.match(/\d{2,5}/);
      return m ? m[0] : undefined;
    }
    case "ownerDocument": {
      // Documento colombiano: 7-10 dígitos, NIT puede llevar guion y dígito
      // de verificación ("900.123.456-7"). Strippeamos puntos antes.
      const stripped = raw.replace(/(\d)\.(\d)/g, "$1$2");
      const m = stripped.match(/\d{6,11}(?:-\d)?/);
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
    case "transmission": {
      // Tesseract no es perfecto distinguiendo MECANICA vs MEC. ANICA, pero
      // estos términos son lo bastante distintivos.
      if (/AUTOMATICA?\b|\bAT\b/.test(raw)) return "automatic";
      if (/\bCVT\b/.test(raw)) return "cvt";
      if (/\bDCT\b|DOBLE\s+EMBRAGUE/.test(raw)) return "dct";
      if (/MANUAL|MECANICA|\bMT\b/.test(raw)) return "manual";
      return undefined;
    }
    case "propertyCardStatus": {
      if (/DUPLICAD/.test(raw)) return "Duplicado";
      if (/ORIGINAL/.test(raw)) return "Original";
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

/**
 * En un VIN ISO 3779 las letras I, O y Q están prohibidas para evitar
 * confusión con 1, 0 y 0. Si Tesseract devuelve un VIN con esas letras es
 * casi seguro que es un error de OCR — las sustituimos por el dígito que
 * confundió. Esta corrección es segura (no puede generar VINs falsamente
 * válidos: los chars sustituidos no eran legales en primer lugar).
 *
 * NO corrige ambigüedades 8↔B, 5↔S, 6↔G, 2↔Z, 4↔A: ambas variantes son
 * legales en VINs y no hay forma de saber cuál es correcta sin el dígito
 * verificador (ISO 3779 § 7) o intervención humana.
 */
export function correctVinForbiddenChars(vin: string): string {
  return vin.replace(/I/g, "1").replace(/[OQ]/g, "0");
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
