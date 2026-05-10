import type { Metadata, Viewport } from "next";
import "./globals.css";

import { ServiceWorkerRegister } from "@/components/shared/sw-register";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "Perito — Peritaje Vehicular",
  description:
    "Sistema profesional de peritajes y avalúos vehiculares. Inspección guiada, análisis de riesgo y generación de informes en PDF.",
  applicationName: "Perito",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Perito",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

/**
 * Script inline que aplica la clase de tema en <html> ANTES de hidratar.
 * Sin esto, el server renderizaba en light, el cliente leía localStorage en
 * un useEffect después de pintar, y el perito veía un flash blanco al cargar
 * en modo dark/outdoor (FART). El script es muy chico, no bloquea perceptible.
 *
 * Lee STORAGE_KEY igual que UIPreferencesProvider — mantener en sync si cambia.
 */
const themeBootstrap = `(function(){try{var raw=localStorage.getItem('perito:ui-prefs:v1');if(!raw)return;var p=JSON.parse(raw);var t=p&&p.theme;if(t==='dark'){document.documentElement.classList.add('dark')}else if(t==='outdoor'){document.documentElement.classList.add('contrast-high')}else if(p&&p.contrastHigh===true){document.documentElement.classList.add('contrast-high')}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://rsms.me/" />
        <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
