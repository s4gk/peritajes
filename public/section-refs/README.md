# Imágenes de referencia por sección del PDF

Cuando el peritaje se renderiza a PDF, antes de la tabla de hallazgos de cada
sección mostramos una imagen ilustrativa de qué se inspeccionó. Sirve para
que el cliente entienda visualmente el alcance del trabajo del perito.

## Cómo agregar/cambiar una imagen

1. Guardá el archivo PNG o JPG con uno de los nombres exactos de abajo en
   `public/section-refs/`.
2. Recomendado: PNG con fondo blanco (o transparente), proporción 16:9 o
   4:3, ancho ~1200px, peso < 200KB.
3. No hace falta tocar código — el template detecta el archivo y lo muestra.

## Nombres esperados

| Sección del peritaje      | Archivo                                   |
|---------------------------|-------------------------------------------|
| Carrocería                | `bodywork.png` o `bodywork.jpg`           |
| Chasis y estructura       | `chassis.png` o `chassis.jpg`             |
| Suspensión (amortiguadores)| `suspension.png` o `suspension.jpg`      |
| Motor                     | `engine.png` o `engine.jpg`               |
| Sistema eléctrico         | `electrical.png` o `electrical.jpg`       |
| Fugas de fluidos          | `leaks.png` o `leaks.jpg`                 |
| Interior delantero        | `comfort.png` o `comfort.jpg`             |
| Prueba de ruta            | `roadTest.png` o `roadTest.jpg`           |
| Llantas y rines           | `tires.png` o `tires.jpg`                 |
| Accesorios                | `accessories.png` o `accessories.jpg`     |

## Cómo se ve en el PDF

La imagen va justo después del título de la sección y antes del bloque de
"X hallazgos detectados". Tiene `page-break-inside: avoid` para que no se
corte entre páginas. Si el archivo no existe, simplemente no se renderiza
nada — la sección sigue funcionando.
