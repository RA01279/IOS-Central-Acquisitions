import "./globals.css";
import "./hopper.css";
import type { Metadata, Viewport } from "next";
import ProductionRedirect from "@/components/ProductionRedirect";
import ServiceWorker from "@/components/ServiceWorker";

export const metadata: Metadata = {
  title: { default: "Hopper", template: "%s · Hopper" },
  description: "Dalfen Industrial acquisitions pipeline",
  manifest: "/manifest.webmanifest",
  applicationName: "Hopper",
  appleWebApp: { capable: true, title: "Hopper", statusBarStyle: "black-translucent" },
  icons: { icon: "/pwa-icon/192", apple: "/pwa-icon/180" },
};

export const viewport: Viewport = {
  themeColor: "#0A2540",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Substitutes for Dalfen's licensed faces (see the design system readme).
            The service worker caches the font files so they work offline. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=IBM+Plex+Mono:wght@400;500;600;700&family=Public+Sans:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <ProductionRedirect />
        <ServiceWorker />
        {children}
      </body>
    </html>
  );
}
