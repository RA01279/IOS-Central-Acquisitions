// lib/ic-deck/iosDemandMap.ts
//
// Shared logic for the IOS Demand Map / IC deck export feature.
// Calls app/api/deals/[id]/demand-map/route.ts, which geocodes the deal's
// property address on the fly and returns a satellite basemap + nearby-tenant
// list. This module turns that response into (a) pixel positions for an
// on-screen preview and (b) a downloadable .pptx matching the IC deck layout.

export type Category = { label: string; keyword: string; color: string };

export const DEFAULT_CATEGORIES: Category[] = [
  { label: "Auto Storage", keyword: "vehicle RV boat storage", color: "7F8C8D" },
  { label: "Building Materials", keyword: "building materials supplier", color: "C9971F" },
  { label: "Chemical/Waste Mgmt", keyword: "waste management chemical distributor", color: "16A085" },
  { label: "Container Storage", keyword: "shipping container storage", color: "8E44AD" },
  { label: "Contractor Yard", keyword: "general contractor construction", color: "C0562B" },
  { label: "Equip. Rental & Sales", keyword: "equipment rental sales", color: "2E6DA4" },
];

export type Tenant = {
  name: string;
  category: string;
  lat: number;
  lng: number;
  placeId: string;
  distanceMi: number;
};

export type DemandMapResponse = {
  address: string;
  center: { lat: number; lng: number };
  radiusMiles: number;
  zoom: number;
  imageBase64: string;
  tenants: Tenant[];
};

/**
 * Calls the Hopper API route for a given deal.
 */
export async function fetchDemandMap(
  dealId: string,
  opts: { radiusMiles?: number; categories?: Category[] } = {}
): Promise<DemandMapResponse> {
  const { radiusMiles = 5, categories = DEFAULT_CATEGORIES } = opts;
  const categoriesParam = categories.map((c) => `${c.label}:${c.keyword}`).join(",");
  const url = `/api/deals/${dealId}/demand-map?radiusMiles=${radiusMiles}&categories=${encodeURIComponent(
    categoriesParam
  )}`;

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ---- Web Mercator projection (matches Google's Static Maps projection exactly) ----

function latLngToWorldPixel(lat: number, lng: number, zoom: number) {
  const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  const scale = 256 * 2 ** zoom;
  const x = (0.5 + lng / 360) * scale;
  const y = (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/**
 * Pixel position of the site and every tenant on the actual raster image
 * returned by the API (2560x2048 at scale=2). Used for the on-screen preview.
 */
export function computePixelPositions(
  data: DemandMapResponse,
  rasterWidth = 2560,
  rasterHeight = 2048,
  apiScale = 2
) {
  const centerPx = latLngToWorldPixel(data.center.lat, data.center.lng, data.zoom);
  const toRaster = (lat: number, lng: number) => {
    const p = latLngToWorldPixel(lat, lng, data.zoom);
    return {
      x: rasterWidth / 2 + (p.x - centerPx.x) * apiScale,
      y: rasterHeight / 2 + (p.y - centerPx.y) * apiScale,
    };
  };
  return {
    site: toRaster(data.center.lat, data.center.lng),
    tenants: data.tenants.map((t) => ({ ...t, px: toRaster(t.lat, t.lng) })),
  };
}

// ---- Export to IC deck (.pptx) ----

// pptxgenjs is loaded from a <script> tag (its browser bundle) rather than
// imported as an npm package. The npm package's main entry pulls in Node
// builtins (fs, https, crypto...) at module-load time for its universal
// Node+browser support, which webpack 5 cannot bundle for the client (it
// throws UnhandledSchemeError on node:fs-style imports -- resolve.alias
// does not intercept scheme-prefixed specifiers, this is a known webpack 5
// limitation, not a config mistake). The CDN bundle is built specifically
// to avoid that: it's plain browser JS with zero Node dependencies.
let pptxScriptPromise: Promise<void> | null = null;
function loadPptxScript(): Promise<void> {
  if (typeof window !== "undefined" && (window as any).PptxGenJS) return Promise.resolve();
  if (pptxScriptPromise) return pptxScriptPromise;
  pptxScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/pptxgenjs@3/dist/pptxgen.bundle.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load pptxgenjs from CDN"));
    document.head.appendChild(script);
  });
  return pptxScriptPromise;
}

export async function exportToPptx(
  data: DemandMapResponse,
  dealMeta: { subtitle?: string; fileName?: string },
  categories: Category[] = DEFAULT_CATEGORIES
) {
  await loadPptxScript();
  const PptxGenJS = (window as any).PptxGenJS;
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";

  const NAVY = "1B2A49",
    WHITE = "FFFFFF",
    INK = "1F2937",
    SUBTLE = "5B6472";
  const mapX = 0.4,
    mapY = 1.15,
    mapW = 7.7,
    mapH = 6.15;
  const SCALE = 0.5; // inches per mile
  const originX = mapX + 3.6,
    originY = mapY + 3.15;

  const slide = pres.addSlide();
  slide.background = { color: WHITE };

  slide.addShape("rect", { x: 0, y: 0, w: 13.333, h: 1.0, fill: { color: NAVY }, line: { type: "none" } });
  slide.addText("IOS DEMAND MAP", {
    x: 0.5, y: 0.12, w: 9, h: 0.42, fontFace: "Arial", fontSize: 22, bold: true, color: WHITE, margin: 0,
  });
  slide.addText(dealMeta.subtitle || data.address, {
    x: 0.5, y: 0.55, w: 12.3, h: 0.35, fontFace: "Arial", fontSize: 11.5, color: "C9D3E0", margin: 0,
  });

  slide.addImage({
    data: data.imageBase64, x: mapX, y: mapY, w: mapW, h: mapH,
    sizing: { type: "cover", w: mapW, h: mapH },
  });
  slide.addShape("roundRect", {
    x: mapX, y: mapY, w: mapW, h: mapH, rectRadius: 0.06,
    fill: { type: "none" }, line: { color: "D8DEE6", width: 1 },
  });

  [1, 3, 5]
    .filter((mi) => mi <= data.radiusMiles)
    .forEach((mi) => {
      const r = mi * SCALE;
      slide.addShape("ellipse", {
        x: originX - r, y: originY - r, w: r * 2, h: r * 2,
        fill: { type: "none" }, line: { color: WHITE, width: 1.25, dashType: "dash" },
      });
      slide.addText(`${mi} mi`, {
        x: originX + r * 0.6, y: originY - r * 0.82, w: 0.46, h: 0.2,
        fontFace: "Arial", fontSize: 8, color: WHITE, align: "center", valign: "middle", margin: 0,
      });
    });

  const siteSize = 0.34;
  slide.addShape("star5", {
    x: originX - siteSize / 2, y: originY - siteSize / 2, w: siteSize, h: siteSize,
    fill: { color: "FF5A4E" }, line: { color: WHITE, width: 1.25 },
  });

  data.tenants.forEach((t, i) => {
    // Pin placement in the pptx (inches) uses a flat dx/dy-in-miles approximation --
    // accurate enough at this scale (a few miles), simpler than reprojecting Mercator
    // pixels into slide inches. The on-screen preview uses the exact projection instead.
    const dxMi = (t.lng - data.center.lng) * 58;
    const dyMi = (t.lat - data.center.lat) * 69;
    const x = originX + dxMi * SCALE,
      y = originY - dyMi * SCALE;
    const color = (categories.find((c) => c.label === t.category) || {}).color || "999999";
    const d = 0.24;
    slide.addShape("ellipse", { x: x - d / 2, y: y - d / 2, w: d, h: d, fill: { color }, line: { color: WHITE, width: 1 } });
    slide.addText(String(i + 1), {
      x: x - d / 2, y: y - d / 2, w: d, h: d,
      fontFace: "Arial", fontSize: 8, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0,
    });
  });

  const legX = mapX + mapW + 0.25,
    legW = 13.333 - legX - 0.4;
  let curY = mapY;
  slide.addText("TENANT KEY BY USE CATEGORY", {
    x: legX, y: curY, w: legW, h: 0.28, fontFace: "Arial", fontSize: 11.5, bold: true, color: NAVY, margin: 0,
  });
  curY += 0.36;

  categories.forEach((cat) => {
    const items = data.tenants
      .map((t, i) => ({ ...t, num: i + 1 }))
      .filter((t) => t.category === cat.label)
      .sort((a, b) => a.distanceMi - b.distanceMi);
    if (!items.length) return;

    slide.addShape("roundRect", {
      x: legX, y: curY, w: legW, h: 0.22, rectRadius: 0.04, fill: { color: cat.color }, line: { type: "none" },
    });
    slide.addText(`${cat.label.toUpperCase()}  (${items.length})`, {
      x: legX + 0.08, y: curY, w: legW - 0.16, h: 0.22,
      fontFace: "Arial", fontSize: 9, bold: true, color: WHITE, valign: "middle", margin: 0,
    });
    curY += 0.27;

    items.forEach((t) => {
      slide.addText(
        [
          { text: `${t.num}  `, options: { bold: true, color: cat.color } },
          { text: t.name, options: { color: INK } },
          { text: `  \u2014 ${t.distanceMi.toFixed(1)} mi`, options: { color: SUBTLE, italic: true } },
        ],
        { x: legX + 0.06, y: curY, w: legW - 0.1, h: 0.155, fontFace: "Arial", fontSize: 8.2, margin: 0 }
      );
      curY += 0.155;
    });
    curY += 0.07;
  });

  slide.addText(
    `Sources: Google Places & Static Maps API. Distances are straight-line from subject (${data.address}).`,
    { x: 0.4, y: 7.18, w: 12.5, h: 0.28, fontFace: "Arial", fontSize: 7.5, italic: true, color: SUBTLE, margin: 0 }
  );

  await pres.writeFile({ fileName: `${dealMeta.fileName || "IOS_Demand_Map"}.pptx` });
}
