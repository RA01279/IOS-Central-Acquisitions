// lib/ic-deck/iosDemandMap.ts
//
// Shared logic for the IOS Demand Map / IC deck export feature.
// Calls app/api/deals/[id]/demand-map/route.ts, which geocodes the deal's
// property address on the fly and returns a satellite basemap + nearby-tenant
// list. This module turns that response into (a) pixel positions for an
// on-screen preview and (b) a downloadable .pptx matching the IC deck layout.
//
// GEOMETRY, and why it's centralised here: the basemap's scale is not a fixed
// number -- it depends on the zoom level Google picked for the requested
// radius, which changes with the radius and (via cos(latitude)) the market. An
// earlier version placed pins in the .pptx with a hardcoded 0.5 inches-per-mile
// while the imagery underneath was at whatever the zoom implied, so pins and
// distance rings sat in the wrong place by 17% at a 5-mile radius and by 66% at
// 7 miles (spilling off the map entirely). Both the preview and the deck now
// derive their scale from the same projection as the imagery, so they agree
// with it and with each other at any radius.

export type Category = { label: string; keywords: string[]; color: string };

// Keep the labels and colours in step with DEFAULT_CATEGORIES in the API route
// -- the route decides which businesses land in which category, this decides
// what colour they're drawn in. The keyword rationale lives in the route.
export const DEFAULT_CATEGORIES: Category[] = [
  // "truck parking lot" is deliberately absent -- it returned food-truck parks
  // and supermarket car parks. The client's list is what the API actually runs
  // (it overrides the route's defaults), so these must stay in step.
  { label: "Auto & RV Storage", keywords: ["RV boat outdoor storage lot", "trailer storage yard"], color: "7F8C8D" },
  { label: "Building Materials", keywords: ["building materials supplier", "lumber yard", "roofing supply"], color: "C9971F" },
  { label: "Chemical/Waste Mgmt", keywords: ["waste management chemical distributor"], color: "16A085" },
  { label: "Container Storage", keywords: ["shipping container storage", "portable storage container sales"], color: "8E44AD" },
  { label: "Contractor Yard", keywords: ["paving contractor", "fence company", "excavating contractor"], color: "C0562B" },
  { label: "Equip. Rental & Sales", keywords: ["equipment rental sales", "crane service"], color: "2E6DA4" },
  { label: "Stone & Masonry", keywords: ["stone yard", "natural stone supplier", "masonry supply"], color: "7D5A3C" },
  { label: "Trucking & Towing", keywords: ["trucking company", "towing service"], color: "2C3E50" },
  { label: "Landscape & Soil", keywords: ["landscape supply yard", "soil compost mulch supplier"], color: "5B8C3A" },
  { label: "Pipe & Steel", keywords: ["pipe supply", "steel supply"], color: "B03A5B" },
];

export type Tenant = {
  name: string;
  category: string;
  lat: number;
  lng: number;
  placeId: string;
  distanceMi: number;
  /** Company site from Place Details. ~100% coverage on real IOS businesses. */
  website?: string | null;
  /** Favicon-derived logo mark as a data: URI. ~75% coverage -- may be null. */
  logoBase64?: string | null;
};

export type MapType = "satellite" | "hybrid";

export type DemandMapResponse = {
  address: string;
  center: { lat: number; lng: number };
  radiusMiles: number;
  zoom: number;
  maptype?: MapType;
  /** Logical px per side of the basemap (square). Reported by the API. */
  mapLogicalSize?: number;
  /** Raster multiplier the basemap was rendered at. Reported by the API. */
  mapScale?: number;
  /** Keyword matches rejected as non-yard uses (self-storage, movers, ...). */
  screenedOut?: number;
  imageBase64: string;
  tenants: Tenant[];
};

// Fallbacks only -- the API reports its real values, and these exist so an
// older cached response still renders. The Maps Static API hard-caps `size` at
// 640x640 logical px; asking for more is silently clamped, which is exactly the
// trap that had this code projecting onto a 1280x1024 image that never existed.
const DEFAULT_LOGICAL_SIZE = 640;
const DEFAULT_SCALE = 2;

const METERS_PER_MILE = 1609.34;

export function logicalSize(data: DemandMapResponse): number {
  return data.mapLogicalSize ?? DEFAULT_LOGICAL_SIZE;
}
export function rasterSize(data: DemandMapResponse): number {
  return logicalSize(data) * (data.mapScale ?? DEFAULT_SCALE);
}

/**
 * Calls the Hopper API route for a given deal.
 */
export async function fetchDemandMap(
  dealId: string,
  opts: { radiusMiles?: number; categories?: Category[]; maptype?: MapType } = {}
): Promise<DemandMapResponse> {
  const { radiusMiles = 5, categories = DEFAULT_CATEGORIES, maptype = "satellite" } = opts;
  // label:kw one;kw two,label:kw three -- ';' separates keywords within a
  // category, ',' separates categories.
  const categoriesParam = categories.map((c) => `${c.label}:${c.keywords.join(";")}`).join(",");
  const url = `/api/deals/${dealId}/demand-map?radiusMiles=${radiusMiles}&maptype=${maptype}&categories=${encodeURIComponent(
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

/** Ground distance covered by one logical map pixel, in meters. */
function metersPerLogicalPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Ground distance covered by one logical map pixel, in miles. */
export function milesPerLogicalPixel(lat: number, zoom: number): number {
  return metersPerLogicalPixel(lat, zoom) / METERS_PER_MILE;
}

/**
 * Pixel position of the site and every tenant on the actual raster image
 * returned by the API. Used for the on-screen preview.
 */
export function computePixelPositions(data: DemandMapResponse) {
  const size = rasterSize(data);
  const apiScale = data.mapScale ?? DEFAULT_SCALE;
  const centerPx = latLngToWorldPixel(data.center.lat, data.center.lng, data.zoom);
  const toRaster = (lat: number, lng: number) => {
    const p = latLngToWorldPixel(lat, lng, data.zoom);
    return {
      x: size / 2 + (p.x - centerPx.x) * apiScale,
      y: size / 2 + (p.y - centerPx.y) * apiScale,
    };
  };
  return {
    size,
    site: toRaster(data.center.lat, data.center.lng),
    tenants: data.tenants.map((t) => ({ ...t, px: toRaster(t.lat, t.lng) })),
  };
}

/**
 * Everything needed to draw on top of the basemap in slide inches, derived from
 * the zoom the imagery was actually rendered at. `mapSideInches` is the drawn
 * side length; the basemap is square and must be drawn square and uncropped for
 * this to hold, which is what the exporter does.
 */
/**
 * How far the (square) basemap reaches from its centre, in miles. This is the
 * limit for drawing distance rings, and the px-per-mile scale for any overlay:
 * half the image's pixel side length maps to exactly this many miles.
 */
export function halfExtentMiles(data: DemandMapResponse): number {
  return (logicalSize(data) / 2) * milesPerLogicalPixel(data.center.lat, data.zoom);
}

export function mapGeometry(data: DemandMapResponse, mapSideInches: number) {
  const size = logicalSize(data);
  const inPerLogicalPx = mapSideInches / size;
  const miPerLogicalPx = milesPerLogicalPixel(data.center.lat, data.zoom);
  const inchesPerMile = inPerLogicalPx / miPerLogicalPx;
  const centerPx = latLngToWorldPixel(data.center.lat, data.center.lng, data.zoom);

  return {
    inchesPerMile,
    halfExtentMi: halfExtentMiles(data),
    /** Offset from the map centre, in inches (dx right, dy down). */
    offsetInches(lat: number, lng: number) {
      const p = latLngToWorldPixel(lat, lng, data.zoom);
      return { dx: (p.x - centerPx.x) * inPerLogicalPx, dy: (p.y - centerPx.y) * inPerLogicalPx };
    },
  };
}

/** Distance rings worth drawing: sensible round numbers that fit the imagery. */
export function ringMiles(radiusMiles: number, halfExtentMi: number): number[] {
  const candidates = radiusMiles <= 3 ? [1, 2, 3] : radiusMiles <= 5 ? [1, 3, 5] : [2, 4, 6, 7];
  return Array.from(new Set([...candidates, radiusMiles]))
    .filter((mi) => mi <= radiusMiles && mi <= halfExtentMi)
    .sort((a, b) => a - b);
}

/** Tenant counts inside each ring -- proximity density, for the IC read. */
export function densityByBand(tenants: Tenant[], bands: number[]) {
  return bands.map((mi) => ({ mi, count: tenants.filter((t) => t.distanceMi <= mi).length }));
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

// -- Slide constants (LAYOUT_WIDE = 13.333 x 7.5in) --
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const NAVY = "1B2A49";
const WHITE = "FFFFFF";
const INK = "1F2937";
const SUBTLE = "5B6472";
const HAIRLINE = "D8DEE6";
const SITE_RED = "FF5A4E";

const HEADER_H = 0.95;
const MAP_X = 0.4;
const MAP_Y = 1.2;
// The basemap is SQUARE (the API's 640x640 cap), and it's drawn undistorted and
// uncropped -- the projection maths depends on that. Sized to the tallest square
// that still leaves room for the footer.
const MAP_SIDE = 6.0;
const RAIL_X = MAP_X + MAP_SIDE + 0.3;
const RAIL_W = SLIDE_W - RAIL_X - 0.4;
const FOOTER_Y = MAP_Y + MAP_SIDE + 0.05;

// Legend line metrics
const LEGEND_HEADER_H = 0.24;
const LEGEND_HEADER_GAP = 0.05;
const LEGEND_ITEM_H = 0.163;
const LEGEND_CAT_GAP = 0.08;

type LegendLine =
  | { kind: "header"; label: string; color: string; count: number; height: number }
  | {
      kind: "item";
      num: number;
      name: string;
      distanceMi: number;
      color: string;
      website?: string | null;
      logoBase64?: string | null;
      height: number;
    };

function buildLegendLines(data: DemandMapResponse, categories: Category[]): LegendLine[] {
  const numbered = data.tenants.map((t, i) => ({ ...t, num: i + 1 }));
  const lines: LegendLine[] = [];
  for (const cat of categories) {
    const items = numbered
      .filter((t) => t.category === cat.label)
      .sort((a, b) => a.distanceMi - b.distanceMi);
    if (!items.length) continue;
    lines.push({
      kind: "header",
      label: cat.label,
      color: cat.color,
      count: items.length,
      height: LEGEND_HEADER_H + LEGEND_HEADER_GAP,
    });
    items.forEach((t, idx) => {
      lines.push({
        kind: "item",
        num: t.num,
        name: t.name,
        distanceMi: t.distanceMi,
        color: cat.color,
        website: t.website ?? null,
        logoBase64: t.logoBase64 ?? null,
        height: LEGEND_ITEM_H + (idx === items.length - 1 ? LEGEND_CAT_GAP : 0),
      });
    });
  }
  return lines;
}

/**
 * Flow legend lines into fixed-height columns. A category header is never left
 * stranded at the bottom of a column without at least two of its items.
 */
function flowIntoColumns(lines: LegendLine[], columnHeight: number): LegendLine[][] {
  const columns: LegendLine[][] = [];
  let current: LegendLine[] = [];
  let used = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let needed = line.height;
    if (line.kind === "header") {
      // Keep the header with its first two items (or however many exist).
      const followers = lines.slice(i + 1, i + 3).filter((l) => l.kind === "item");
      needed += followers.reduce((s, l) => s + l.height, 0);
    }
    if (used + needed > columnHeight && current.length > 0) {
      columns.push(current);
      current = [];
      used = 0;
    }
    current.push(line);
    used += line.height;
  }
  if (current.length) columns.push(current);
  return columns;
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

  const geo = mapGeometry(data, MAP_SIDE);
  const originX = MAP_X + MAP_SIDE / 2;
  const originY = MAP_Y + MAP_SIDE / 2;

  const addHeader = (slide: any, continued: boolean) => {
    slide.background = { color: WHITE };
    slide.addShape("rect", {
      x: 0, y: 0, w: SLIDE_W, h: HEADER_H, fill: { color: NAVY }, line: { type: "none" },
    });
    slide.addText("IOS DEMAND MAP", {
      x: 0.5, y: 0.1, w: 9, h: 0.4, fontFace: "Arial", fontSize: 21, bold: true,
      charSpacing: 1, color: WHITE, margin: 0,
    });
    slide.addText(
      (dealMeta.subtitle || data.address) + (continued ? "  —  tenant key (cont.)" : ""),
      { x: 0.5, y: 0.52, w: 12.3, h: 0.34, fontFace: "Arial", fontSize: 11, color: "C9D3E0", margin: 0 }
    );
  };

  const addFooter = (slide: any) => {
    slide.addText(
      `Sources: Google Places & Static Maps API. Distances are straight-line from the subject property (${data.address}). Generated ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`,
      { x: MAP_X, y: FOOTER_Y, w: 12.5, h: 0.22, fontFace: "Arial", fontSize: 7.5, italic: true, color: SUBTLE, margin: 0 }
    );
  };

  // ---------------- Slide 1: map ----------------
  const slide = pres.addSlide();
  addHeader(slide, false);

  slide.addImage({ data: data.imageBase64, x: MAP_X, y: MAP_Y, w: MAP_SIDE, h: MAP_SIDE });
  slide.addShape("roundRect", {
    x: MAP_X, y: MAP_Y, w: MAP_SIDE, h: MAP_SIDE, rectRadius: 0.06,
    fill: { type: "none" }, line: { color: HAIRLINE, width: 1 },
  });

  // Distance rings, now at the imagery's real scale.
  const rings = ringMiles(data.radiusMiles, geo.halfExtentMi);
  rings.forEach((mi) => {
    const r = mi * geo.inchesPerMile;
    slide.addShape("ellipse", {
      x: originX - r, y: originY - r, w: r * 2, h: r * 2,
      fill: { type: "none" }, line: { color: WHITE, width: 1.25, dashType: "dash" },
    });
    // Dark chip behind the label -- white text alone disappears over pale
    // rooftops and concrete, which is most of an IOS submarket.
    const chipW = 0.42, chipH = 0.19;
    const chipX = originX - chipW / 2, chipY = originY - r - chipH / 2;
    slide.addShape("roundRect", {
      x: chipX, y: chipY, w: chipW, h: chipH, rectRadius: 0.03,
      fill: { color: "000000", transparency: 35 }, line: { type: "none" },
    });
    slide.addText(`${mi} mi`, {
      x: chipX, y: chipY, w: chipW, h: chipH,
      fontFace: "Arial", fontSize: 8, bold: true, color: WHITE,
      align: "center", valign: "middle", margin: 0,
    });
  });

  // Tenant pins. Dark halo under each so the colour reads on bright imagery.
  data.tenants.forEach((t, i) => {
    const { dx, dy } = geo.offsetInches(t.lat, t.lng);
    const x = originX + dx, y = originY + dy;
    const color = categories.find((c) => c.label === t.category)?.color || "999999";
    const d = 0.26;
    slide.addShape("ellipse", {
      x: x - d / 2 - 0.02, y: y - d / 2 - 0.02, w: d + 0.04, h: d + 0.04,
      fill: { color: "000000", transparency: 55 }, line: { type: "none" },
    });
    slide.addShape("ellipse", {
      x: x - d / 2, y: y - d / 2, w: d, h: d,
      fill: { color }, line: { color: WHITE, width: 1.25 },
    });
    slide.addText(String(i + 1), {
      x: x - d / 2, y: y - d / 2, w: d, h: d,
      fontFace: "Arial", fontSize: 9, bold: true, color: WHITE,
      align: "center", valign: "middle", margin: 0,
    });
  });

  // Subject marker last, so it sits above every pin.
  const siteSize = 0.36;
  slide.addShape("ellipse", {
    x: originX - siteSize * 0.85, y: originY - siteSize * 0.85, w: siteSize * 1.7, h: siteSize * 1.7,
    fill: { color: "000000", transparency: 60 }, line: { type: "none" },
  });
  slide.addShape("star5", {
    x: originX - siteSize / 2, y: originY - siteSize / 2, w: siteSize, h: siteSize,
    fill: { color: SITE_RED }, line: { color: WHITE, width: 1.5 },
  });
  slide.addShape("roundRect", {
    x: originX - 0.42, y: originY + siteSize * 0.62, w: 0.84, h: 0.2, rectRadius: 0.03,
    fill: { color: "000000", transparency: 30 }, line: { type: "none" },
  });
  slide.addText("SUBJECT", {
    x: originX - 0.42, y: originY + siteSize * 0.62, w: 0.84, h: 0.2,
    fontFace: "Arial", fontSize: 7.5, bold: true, charSpacing: 0.5, color: WHITE,
    align: "center", valign: "middle", margin: 0,
  });

  // ---------------- Right rail: the IC read ----------------
  let railY = MAP_Y;
  slide.addText(String(data.tenants.length), {
    x: RAIL_X, y: railY - 0.06, w: 1.5, h: 0.62,
    fontFace: "Arial", fontSize: 40, bold: true, color: NAVY, margin: 0,
  });
  slide.addText(
    [
      { text: "potential IOS users\n", options: { bold: true, color: INK } },
      { text: `within ${data.radiusMiles} miles of the subject`, options: { color: SUBTLE } },
    ],
    { x: RAIL_X + 1.05, y: railY + 0.02, w: RAIL_W - 1.05, h: 0.55, fontFace: "Arial", fontSize: 10, lineSpacingMultiple: 1.1, margin: 0 }
  );
  railY += 0.68;

  // Density by proximity band -- how concentrated the demand is, not just how much.
  const bands = densityByBand(data.tenants, rings);
  if (bands.length) {
    slide.addText(
      bands.map((b, i) => [
        { text: `${b.count}`, options: { bold: true, color: NAVY } },
        { text: ` within ${b.mi} mi`, options: { color: SUBTLE } },
        ...(i < bands.length - 1 ? [{ text: "     ", options: { color: SUBTLE } }] : []),
      ]).flat(),
      { x: RAIL_X, y: railY, w: RAIL_W, h: 0.2, fontFace: "Arial", fontSize: 8.5, margin: 0 }
    );
    railY += 0.3;
  }

  slide.addShape("rect", {
    x: RAIL_X, y: railY, w: RAIL_W, h: 0.012, fill: { color: HAIRLINE }, line: { type: "none" },
  });
  railY += 0.14;
  slide.addText("TENANT KEY BY USE CATEGORY", {
    x: RAIL_X, y: railY, w: RAIL_W, h: 0.24,
    fontFace: "Arial", fontSize: 10, bold: true, charSpacing: 0.6, color: NAVY, margin: 0,
  });
  railY += 0.32;

  // Two columns in the rail, overflowing to a second slide when a dense
  // submarket produces more tenants than the rail can hold. The old version
  // just let the list run off the bottom of the slide.
  const colGap = 0.22;
  const colW = (RAIL_W - colGap) / 2;
  const colHeight = FOOTER_Y - railY - 0.08;
  const columns = flowIntoColumns(buildLegendLines(data, categories), colHeight);

  const drawColumn = (target: any, lines: LegendLine[], x: number, top: number, w: number) => {
    let y = top;
    for (const line of lines) {
      if (line.kind === "header") {
        target.addShape("roundRect", {
          x, y, w, h: LEGEND_HEADER_H, rectRadius: 0.03,
          fill: { color: line.color }, line: { type: "none" },
        });
        target.addText(`${line.label.toUpperCase()}  (${line.count})`, {
          x: x + 0.08, y, w: w - 0.16, h: LEGEND_HEADER_H,
          fontFace: "Arial", fontSize: 8.5, bold: true, charSpacing: 0.3,
          color: WHITE, valign: "middle", margin: 0,
        });
      } else {
        // Logo gutter is reserved on every row whether or not this tenant has
        // a logo, so names stay left-aligned down the column. Roughly a quarter
        // of tenants have no usable icon.
        const LOGO_BOX = 0.15;
        const textX = x + 0.04 + LOGO_BOX + 0.05;
        if (line.logoBase64) {
          target.addImage({
            data: line.logoBase64,
            x: x + 0.04,
            y: y + (LEGEND_ITEM_H - LOGO_BOX) / 2,
            w: LOGO_BOX,
            h: LOGO_BOX,
            ...(line.website
              ? { hyperlink: { url: line.website, tooltip: line.name } }
              : {}),
          });
        }
        target.addText(
          [
            { text: `${line.num}`.padStart(2, " ") + " ", options: { bold: true, color: line.color } },
            {
              text: line.name,
              // Hyperlinked but deliberately not blue-underlined -- 40-odd
              // underlined links would shred the page. It still opens on click.
              options: line.website
                ? { color: INK, hyperlink: { url: line.website, tooltip: line.website } }
                : { color: INK },
            },
            { text: `  ${line.distanceMi.toFixed(1)} mi`, options: { color: SUBTLE } },
          ],
          { x: textX, y, w: w - (textX - x) - 0.04, h: LEGEND_ITEM_H,
            fontFace: "Arial", fontSize: 8, margin: 0 }
        );
      }
      y += line.height;
    }
  };

  drawColumn(slide, columns[0] ?? [], RAIL_X, railY, colW);
  drawColumn(slide, columns[1] ?? [], RAIL_X + colW + colGap, railY, colW);
  addFooter(slide);

  // ---------------- Overflow slides: key only, four columns ----------------
  const remaining = columns.slice(2);
  if (remaining.length) {
    const overflowTop = MAP_Y + 0.1;
    const overflowHeight = FOOTER_Y - overflowTop - 0.08;
    // Re-flow the leftover lines to the taller full-width columns rather than
    // reusing the narrow rail columns.
    const leftover = remaining.flat();
    const wideCols = flowIntoColumns(leftover, overflowHeight);
    const perSlide = 4;
    for (let i = 0; i < wideCols.length; i += perSlide) {
      const chunk = wideCols.slice(i, i + perSlide);
      const s = pres.addSlide();
      addHeader(s, true);
      const gap = 0.28;
      const w = (SLIDE_W - MAP_X * 2 - gap * (perSlide - 1)) / perSlide;
      chunk.forEach((col, ci) => drawColumn(s, col, MAP_X + ci * (w + gap), overflowTop, w));
      addFooter(s);
    }
  }

  await pres.writeFile({ fileName: `${dealMeta.fileName || "IOS_Demand_Map"}.pptx` });
}
