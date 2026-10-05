import type { MetadataRoute } from "next";

// Installable Hopper. start_url goes through /resume, which reopens the last
// route this device was on (lib/recent.ts) -- "fast re-entry".
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Hopper · Dalfen Industrial",
    short_name: "Hopper",
    description: "Acquisitions pipeline, site scoring, demand maps and IC decks.",
    start_url: "/resume?source=pwa",
    scope: "/",
    display: "standalone",
    background_color: "#0A2540",
    theme_color: "#0A2540",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New Deal", url: "/deals/new", icons: [{ src: "/pwa-icon/96", sizes: "96x96" }] },
      { name: "Last deal opened", short_name: "Resume", url: "/resume?deal=1", icons: [{ src: "/pwa-icon/96", sizes: "96x96" }] },
      { name: "IC Decks", url: "/ic", icons: [{ src: "/pwa-icon/96", sizes: "96x96" }] },
    ],
  };
}
