import { WizardFromUrl } from "@/components/wizard/wizard-from-url";

// El id NO se lee de `params` en el servidor: el HTML de esta ruta tiene que
// ser idéntico para cualquier peritaje, porque sin red el service worker
// sirve un cascarón cacheado (`/inspection/offline-shell`) para cualquier
// `/inspection/<id>`. El wizard toma el id de la URL en el cliente.
export default function InspectionPage() {
  return (
    <div className="min-h-screen bg-muted/30 py-6">
      <div className="mx-auto w-full max-w-screen-2xl">
        <WizardFromUrl />
      </div>
    </div>
  );
}
