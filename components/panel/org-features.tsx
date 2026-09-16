"use client";

import * as React from "react";

/**
 * Interruptores de producto que dependen de la ORGANIZACIÓN, no del usuario.
 * Salen de `company_config` y el layout del panel los inyecta una sola vez, así
 * el wizard (que corre offline) los tiene disponibles sin pegarle a la red:
 * quedan embebidos en el HTML que el service worker cachea.
 */
export type OrgFeatures = {
  /** La org emite el concepto de asegurabilidad SÍ/NO en sus peritajes. */
  insurabilityVerdict: boolean;
};

const DEFAULT_FEATURES: OrgFeatures = { insurabilityVerdict: false };

const OrgFeaturesContext = React.createContext<OrgFeatures>(DEFAULT_FEATURES);

export function OrgFeaturesProvider({
  features,
  children,
}: {
  features: OrgFeatures;
  children: React.ReactNode;
}) {
  return (
    <OrgFeaturesContext.Provider value={features}>
      {children}
    </OrgFeaturesContext.Provider>
  );
}

/** Fuera del layout del panel devuelve todo apagado, que es el default seguro. */
export function useOrgFeatures(): OrgFeatures {
  return React.useContext(OrgFeaturesContext);
}
