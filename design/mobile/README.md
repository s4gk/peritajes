# Perito · versión mobile (rediseño tipo app nativa)

Diseño de referencia para llevar el panel y el wizard a una experiencia mobile nativa.

- **Lienzo interactivo:** https://claude.ai/artifact/EukxjDSsZranWFczFYFzvV (25 pantallas en 4 páginas).
- **Capturas:** `capturas/*.jpg` (390 px de ancho), por si no tienes acceso al lienzo.
- **Fuente:** `pantallas/*.dc.html` + `canvas.json`, generados por `generar.py`
  (`python3 design/mobile/generar.py`). Si cambias el diseño, edita el script y regenera.

Tokens y componentes salen del código real: `app/globals.css` (tema claro),
`components/ui/*` (button, badge, card, input) e íconos `lucide-react`.

## Decisiones de diseño

| Tema | Hoy | Mobile |
|---|---|---|
| Navegación | Sidebar en drawer (`components/panel/sidebar.tsx`) | Barra inferior: Inicio · Agenda · **+ Nuevo** · Peritajes · Más |
| Employee | No ve Dashboard | Primera pestaña = Agenda |
| Admin | Sección "Administrador" en sidebar | Barra propia: Panel · Clientes · Peritajes · Auditoría · Más |
| Ítems secundarios | En el sidebar | Pantalla **Más** (Vehículos, Propietarios, Empresa, Empleados, WhatsApp, Mi cuenta, tema, guía, salir) |
| Wizard | Stepper + nav inferior | Sin tab bar; encabezado con placa + estado de guardado; hoja inferior de pasos; Atrás/Siguiente fijos |
| Calificación por módulos | Inputs numéricos `w-24` | Stepper − / + por pilar, cálculo automático como referencia, estado general ponderado |
| Acciones por fila (empleados, peritajes) | Varios botones en línea | Ícono "más" que abre hoja inferior |
| Toques | Mixto | Mínimo 44 px en todo control |

## Pantallas

| Página | Archivos |
|---|---|
| Operación diaria | `Login`, `Main` (Inicio), `Agenda`, `NuevoPeritaje`, `Peritajes`, `Mas` |
| Inspección | `PasoVehiculo`, `PasoRecorrido`, `PasoLlanta`, `PasoFugas`, `PasoFotos`, `PasoResumen`, `PasosDelPeritaje` |
| Gestión | `Vehiculos`, `Propietario`, `Empleados`, `EmpleadoAcciones`, `Empresa`, `WhatsApp`, `MiCuenta` |
| Admin y público | `AdminPanel`, `Clientes`, `Auditoria`, `FirmaCliente`, `FirmaObligatoria` |

Pendientes de diseñar: tema oscuro / Exterior, calendario mensual, escáner de tarjeta, prueba de ruta.

## Hallazgo lateral

`/cuenta` muestra Rol "Dueño" también a los empleados (condición `admin ? "Administrador" : "Dueño"`).
