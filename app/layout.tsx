import type { Metadata, Viewport } from "next";
import "./globals.css";

import { PWAInstallPrompt } from "@/components/shared/pwa-install-prompt";
import { PWAUpdatePrompt } from "@/components/shared/pwa-update-prompt";
import { ServiceWorkerRegister } from "@/components/shared/sw-register";
import { ToastProvider } from "@/components/ui/toast";

/**
 * Apple Touch Startup Images — uno por combinación (device-width, device-height,
 * DPR) que iOS Safari respeta cuando la PWA arranca standalone. Sin estos el
 * cold start muestra una pantalla blanca hasta que el JS hidrata. El array
 * lo genera scripts/generate-apple-splash.mjs y queda volcado en
 * public/icons/splash/manifest-meta.json — acá lo replicamos hardcoded para
 * que Next.js los emita en el <head> sin un fetch en build time.
 */
const APPLE_SPLASH = [
  { src: "/icons/splash/iphone-15-16-pro-max-portrait.png", media: "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  { src: "/icons/splash/iphone-14-15-pro-max-portrait.png", media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  { src: "/icons/splash/iphone-14-15-16-pro-portrait.png", media: "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  { src: "/icons/splash/iphone-13-pro-max-12-pro-max-portrait.png", media: "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  { src: "/icons/splash/iphone-14-13-13-pro-12-12-pro-portrait.png", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  { src: "/icons/splash/iphone-13-mini-12-mini-x-xs-portrait.png", media: "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  { src: "/icons/splash/iphone-11-xr-portrait.png", media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
  { src: "/icons/splash/iphone-se-8-7-portrait.png", media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
  { src: "/icons/splash/ipad-pro-12.9-portrait.png", media: "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
  { src: "/icons/splash/ipad-pro-11-portrait.png", media: "(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
  { src: "/icons/splash/ipad-air-portrait.png", media: "(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
  { src: "/icons/splash/ipad-portrait.png", media: "(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
];

export const metadata: Metadata = {
  title: "Peritajes del Llano",
  description:
    "Sistema profesional de peritajes y avalúos vehiculares. Inspección guiada, análisis de riesgo y generación de informes en PDF.",
  applicationName: "Peritajes del Llano",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: "/icons/favicon-32.png",
  },
  appleWebApp: {
    capable: true,
    title: "Peritajes del Llano",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

/**
 * Viewport sin maximumScale para no bloquear el zoom de accesibilidad (la
 * gente con baja visión necesita poder ampliar). `viewport-fit=cover` mantiene
 * la app usando la pantalla completa en iPhones con notch.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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

/**
 * Red de seguridad contra el crash "Failed to execute 'removeChild' on 'Node':
 * The node to be removed is not a child of this node". Lo dispara cualquier
 * agente que mueva nodos del DOM por fuera de React — sobre todo la traducción
 * automática del navegador (Google Translate envuelve los textos en <font> y
 * cuando React desmonta un paso del wizard ya no encuentra el nodo donde lo
 * dejó). Parcheamos removeChild/insertBefore para degradar a no-op en vez de
 * tirar el ErrorBoundary. Workaround conocido del issue facebook/react#11538.
 *
 * Va como script inline en <head> para instalarse ANTES de que React hidrate.
 */
const domGuard = `(function(){if(typeof Node!=='function'||!Node.prototype)return;var rc=Node.prototype.removeChild;Node.prototype.removeChild=function(child){if(child&&child.parentNode!==this){if(child&&child.parentNode){try{return child.parentNode.removeChild(child)}catch(e){}}return child}return rc.apply(this,arguments)};var ib=Node.prototype.insertBefore;Node.prototype.insertBefore=function(newNode,referenceNode){if(referenceNode&&referenceNode.parentNode!==this){return newNode}return ib.apply(this,arguments)}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" translate="no">
      <head>
        {/* App monolingüe (es-CO): evitamos que el navegador la traduzca, ya
            que la traducción reescribe el DOM y rompe la reconciliación de
            React en el wizard (ver domGuard). */}
        <meta name="google" content="notranslate" />
        <script dangerouslySetInnerHTML={{ __html: domGuard }} />
        <link rel="preconnect" href="https://rsms.me/" />
        <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
        {APPLE_SPLASH.map((s) => (
          <link
            key={s.src}
            rel="apple-touch-startup-image"
            href={s.src}
            media={s.media}
          />
        ))}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorkerRegister />
        <PWAUpdatePrompt />
        <PWAInstallPrompt />
      </body>
    </html>
  );
}
