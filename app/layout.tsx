import type { Metadata, Viewport } from "next";
import "./globals.css";

import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "Perito — Peritaje Vehicular",
  description:
    "Sistema profesional de peritajes y avalúos vehiculares. Inspección guiada, análisis de riesgo y generación de informes en PDF.",
  applicationName: "Perito",
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
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
