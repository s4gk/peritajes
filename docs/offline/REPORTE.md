# Reporte: Perito funcionando sin internet

Rama `feat/offline-first` (worktree `/home/dev/perito-offline`). **Nada de esto está en producción**:
no se desplegó, no se hizo push ni merge. Producción (`/home/dev/perito`, pm2 `perito`) no se tocó.

## En una frase

Con el celular en modo avión (y la sesión iniciada antes con señal), el perito ya puede abrir la app,
crear un peritaje nuevo o abrir uno que tenía, llenar todo, tomar fotos, leer la tarjeta con el OCR del
celular, hacer firmar al cliente en pantalla y finalizar. Cuando vuelve la señal todo sube solo, el
servidor le asigna el consecutivo y genera el PDF. Esto se probó de punta a punta con un robot
(Puppeteer) contra una copia de la app y una base de datos de pruebas.

## Qué quedó funcionando

1. **El wizard abre sin red.** Antes, sin señal, abrir o crear un peritaje mostraba "Sin conexión". Ahora
   el celular guarda una "plantilla" del wizard y la usa para cualquier peritaje; los datos salen del
   almacenamiento del celular.
2. **Todo lo que la app necesita se descarga por adelantado** (pantallas y código, ~2 MB), aunque el perito
   nunca haya abierto el wizard con esa versión.
3. **Abrir la app desde el ícono sin red** funciona para dueño y para perito (antes al perito le salía
   "Sin conexión" porque él no tiene tablero de inicio).
4. **OCR de la tarjeta sin internet.** El lector de la tarjeta (Tesseract) ya no se baja de internet cada
   vez: queda guardado en el celular (~12 MB, una sola vez; no se vuelve a bajar en cada actualización).
5. **Borradores completos para trabajar sin señal.** Con señal, la app baja con fotos los borradores
   abiertos del perito de los últimos 30 días (hasta 8), así puede abrirlos después en un sitio sin cobertura.
6. **Finalizar sin red.** Queda finalizado en el celular con el aviso *"PDF pendiente: se genera al volver
   la señal"*. Al volver la señal aparece el consecutivo sin tener que recargar.
7. **Lo que necesita internet lo dice claro** en vez de fallar: vista previa del PDF, descargar PDF, firma
   por QR y link de firma remota quedan deshabilitados con un mensaje. La firma del cliente en pantalla sí
   funciona sin red.
8. **Avisos para el perito:**
   - "Tienes N peritajes sin subir" (visible en el celular; importante en iPhone, que no sube nada en
     segundo plano: hay que abrir la app con señal).
   - "Tu sesión se venció": los cambios NO se pierden; el perito vuelve a entrar (con su mismo usuario) y
     suben solos.
   - "El celular se quedó sin espacio": antes ese error se tragaba en silencio y se perdían cambios.
   - Si intenta **cerrar sesión con peritajes sin subir**, la app pregunta antes (cerrar sesión borra los
     datos del celular).
9. **Sin mezclar usuarios** en un celular compartido: al cerrar sesión se borra la plantilla guardada (lleva
   el nombre del usuario) y si entra otro usuario la app descarta lo del anterior.

### Errores reales que aparecieron probando y quedaron arreglados

- **La cola de subida se desordenaba.** Si un cambio fallaba varias veces (por ejemplo, horas sin señal
  con el celular "creyendo" que tenía red), la cola se lo saltaba y mandaba el siguiente. Resultado real
  reproducido: el peritaje llegaba al servidor ya "finalizado" pero **sin consecutivo y sin PDF**. Ahora
  nunca se adelanta un cambio de un mismo peritaje, y la falta de red no cuenta como "fallo".
- La subida del celular y la del service worker podían correr al mismo tiempo y mandar lo mismo dos veces;
  ahora se turnan.
- Al abrir la plantilla sin red salía un error interno de React (se corregía solo, pero recargaba la pantalla).

## Cómo se probó (resultados reales)

- **Prueba automática de punta a punta** `node scripts/e2e-offline.mjs` (build de producción local en el
  puerto 3460, base `perito_offline_e2e`). Resultado de la última corrida: **49 de 49 verificaciones OK**
  (~85 s). Lo que hace:
  1. Con señal: entra como perito, espera que el celular quede listo para trabajar sin red, crea un
     borrador A, y se crea "desde otro dispositivo" un borrador C con foto.
  2. Sin red: abre A desde la lista y lo edita; abre C y se ve su foto; crea B desde "Nuevo peritaje",
     llena los datos, lee la tarjeta con el OCR del celular, sube las 8 fotos, firma el cliente en
     pantalla y finaliza. Verifica los mensajes de "sin red" y el aviso de PDF pendiente.
  3. Sin red: recarga (B sigue ahí) y abre la app "desde el ícono" en una pestaña nueva.
  4. Vuelve la red: comprueba en la base de datos que B quedó finalizado **con consecutivo y PDF**
     (≈2,4 MB) y que la edición de A llegó.
  5. Sesión vencida (se borra la sesión en la base): aparece el aviso, se vuelve a entrar y el cambio sube.
  6. Cerrar sesión con cambios sin subir pide confirmación.
  7. Cerrar sesión borra lo guardado; al entrar el dueño no ve nada del perito.
  8. Celular sin espacio: aparece el aviso (simulado, ver riesgos).
- **Pruebas unitarias:** `npm run test` → 239 pruebas OK (se agregaron 20: cola de subida, sesión vencida,
  orden, regla de conflictos, manifiesto de archivos, OCR).
- `npm run typecheck` y `npm run lint`: sin errores.
- **Estabilidad:** se corrió la prueba completa más de 15 veces. Hubo dos fallas, las dos del robot y no
  de la app (una recarga automática de la app lo interrumpía, y otra vez leyó el aviso "Instalar Peritajes
  del Llano" en vez del diálogo del escáner y creyó que el OCR se había colgado). Ambas corregidas; después
  de eso, **7 corridas seguidas 49/49**.

## Sigue necesitando internet (y lo avisa)

Primer inicio de sesión en el celular, firma remota (QR o link por WhatsApp), OCR con IA (si está activo,
sin red usa el del celular directamente), vista previa y descarga del PDF, y el panel del dueño con datos
al día (sin red muestra lo último que vio).

## Cambios de comportamiento que conviene saber

1. **Conflictos (un peritaje editado en dos lados):** si el celular tiene cambios sin subir de un
   peritaje, **gana lo del celular** (es lo que el perito ve y lo que se va a subir; al subir reemplaza lo
   del servidor). Si no tiene cambios pendientes, gana el servidor. Antes se decidía solo por la hora de
   modificación aunque hubiera cambios pendientes, lo que podía mostrar una versión y subir otra.
   Excepción: un informe **finalizado** que el perito ya no puede editar → gana el servidor.
2. **Rechazo "Sin permisos" (403) genérico:** antes el cambio se botaba en silencio; ahora queda en la cola
   marcado como fallido (se ve en rojo y se puede limpiar a mano). Así no se pierden datos sin avisar.
3. **Si el servidor no encuentra el peritaje al subir un cambio (404):** se recrea como borrador y luego se
   aplica el cambio, para que el cierre (consecutivo + PDF) sí ocurra.
4. **Cerrar sesión** con cambios sin subir ahora pide confirmación.

## Riesgos y limitaciones

- **Señal "fantasma"** (el celular dice que tiene red pero no carga): al abrir un peritaje la app espera
  hasta ~4 s antes de usar lo guardado (otras pantallas, hasta ~12 s). Con modo avión o sin cobertura real
  es inmediato. Este caso se revisó en código; la prueba automática no simula señal fantasma.
- **iPhone:** no sube nada en segundo plano; sube al abrir la app o volver a ella con señal (hay aviso).
- **OCR:** se probó con una tarjeta sintética (texto impreso limpio); leyó marca, línea y modelo. Con fotos
  reales la calidad es la misma de antes (mismo motor), solo cambia que ya no necesita internet.
- **Espacio lleno:** el aviso se probó simulando el error (Chrome de pruebas no aplica la cuota real).
  `navigator.storage.persist()` se pide, pero el navegador decide si lo concede.
- **OCR con IA + sin red:** revisado en código (va directo al OCR del celular); la prueba automática corre
  con el OCR de IA apagado para no gastar.
- **Primera vez tras cada actualización** el celular baja de nuevo las pantallas (~2 MB). El OCR (~12 MB)
  solo se baja la primera vez o si cambia la versión de la librería.
- Si el perito **nunca abrió la app con señal después de iniciar sesión** en ese celular, no hay nada guardado
  y sin red no funcionará (es el "primer login" que sigue necesitando internet).

## Pasos para desplegar (cuando lo decidas)

1. Revisar y hacer merge de `feat/offline-first` a la rama que corresponda.
2. En `/home/dev/perito`: `git pull`, `npm ci` (por si acaso), `npm run build`.
3. `pm2 restart perito` **justo después del build** (el build pisa `.next` de la app viva).
4. La versión del service worker ya viene subida (`VERSION = "v31"` en `public/sw.js`). Si se despliega
   algo más encima, subirla otra vez.
5. Probar en un celular: entrar con señal, esperar ~1 minuto en la lista de peritajes (baja todo), poner
   modo avión, crear un peritaje y finalizarlo; quitar modo avión y ver que aparezca el consecutivo.

No hay migraciones de base de datos. Rutas nuevas: `/api/offline/manifest` (lista de archivos a guardar) y
`/tesseract/<versión>/<archivo>` (archivos del OCR). Ambas son públicas y solo sirven archivos estáticos.

## Para correr la prueba automática

```bash
cd /home/dev/perito-offline
npx next build
node scripts/e2e-offline.mjs      # levanta y apaga su propio server en :3460
```

Solo corre contra la base `perito_offline_e2e` (se niega con otra). Deja capturas y el resultado en
`/tmp/perito-e2e/`.
