// lib/ic-deck/portfolioMap.ts
//
// "Target Property vs. Our Portfolio" as one IC slide.
//
// Fetches a plain basemap from the server (which holds the Google key) and
// places every pin itself, using the shared Web Mercator arithmetic in ./geo.
// Pins are drawn rather than requested as `markers=` for three reasons: Static
// Maps only offers a few preset colours and single-character labels, forty-odd
// markers would run the URL past its 8k limit, and drawing them means the slide
// and the on-screen map can be styled identically.
//
// pptxgenjs comes from a CDN <script> rather than npm -- see the note in
// iosDemandMap.ts, which hit the same webpack 5 limitation first.

import { mapGeometryFor } from "./geo";

export interface PortfolioMapResponse {
  target: {
    address: string;
    city: string | null;
    market: string | null;
    submarket: string | null;
    buildingSf: number | null;
    lotSf: number | null;
    stage: string;
    assetClass: string | null;
    lat: number;
    lng: number;
  };
  assets: {
    id: string;
    address: string;
    city: string | null;
    state: string | null;
    market: string | null;
    status: string;
    occupancy: string | null;
    site_acres: number | null;
    building_sf: number | null;
    latitude: number;
    longitude: number;
    distanceMi: number;
  }[];
  comps: {
    id: string;
    comp_type: "lease" | "sale";
    address: string;
    latitude: number;
    longitude: number;
    distanceMi: number;
  }[];
  pipeline: {
    id: string;
    stage: string;
    address: string;
    city: string | null;
    latitude: number;
    longitude: number;
    distanceMi: number;
  }[];
  radiusMiles: number;
  maptype: string;
  zoom: number;
  mapLogicalSize: number;
  mapScale: number;
  imageBase64: string;
}

let pptxScriptPromise: Promise<void> | null = null;
function loadPptxScript(): Promise<void> {
  if (typeof window !== "undefined" && (window as any).PptxGenJS) return Promise.resolve();
  if (pptxScriptPromise) return pptxScriptPromise;
  pptxScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/pptxgenjs@3/dist/pptxgen.bundle.js";
    script.onload = () => resolve();
    script.onerror = () => {
      pptxScriptPromise = null;
      script.remove();
      reject(new Error("Failed to load pptxgenjs from CDN. Please retry."));
    };
    document.head.appendChild(script);
  });
  return pptxScriptPromise;
}

// -- Slide layout (LAYOUT_WIDE = 13.333 x 7.5in) --
const SLIDE_W = 13.333;
const NAVY = "1B2A49";
const WHITE = "FFFFFF";
const INK = "1F2937";
const SUBTLE = "5B6472";
const HAIRLINE = "D8DEE6";

const TARGET_RED = "FF5A4E";
const ASSET_PURPLE = "6C4AB6";
const ASSET_AVAIL = "C77DFF";
const LEASE_BLUE = "2E6DA4";
const SALE_GREEN = "1E7A46";

const HEADER_H = 0.95;
const MAP_X = 0.4;
const MAP_Y = 1.2;
const MAP_SIDE = 5.6; // square, with room for the legend and provenance below
const PANEL_X = MAP_X + MAP_SIDE + 0.4;
const PANEL_W = SLIDE_W - PANEL_X - 0.4;

export async function fetchPortfolioMap(
  dealId: string,
  opts: { radiusMiles: number; layers: string[]; maptype: string; includeSold: boolean; includeImage?: boolean }
): Promise<PortfolioMapResponse> {
  const q = new URLSearchParams({
    radius: String(opts.radiusMiles),
    layers: opts.layers.join(","),
    maptype: opts.maptype,
    sold: opts.includeSold ? "1" : "0",
    image: opts.includeImage === false ? "0" : "1",
  });
  const res = await fetch(`/api/deals/${dealId}/portfolio-map?${q}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

/** Round numbers for distance rings that actually fit the imagery. */
function ringsFor(radiusMiles: number, halfExtentMi: number): number[] {
  const candidates =
    radiusMiles <= 5 ? [1, 3, 5] : radiusMiles <= 25 ? [5, 10, 25] : radiusMiles <= 50 ? [10, 25, 50] : [25, 50, 100];
  return Array.from(new Set([...candidates, radiusMiles]))
    .filter((mi) => mi <= radiusMiles && mi <= halfExtentMi)
    .sort((a, b) => a - b);
}

export async function exportPortfolioMap(data: PortfolioMapResponse): Promise<void> {
  await loadPptxScript();
  const PptxGenJS = (window as any).PptxGenJS;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";

  const slide = pptx.addSlide();
  const geo = mapGeometryFor(
    data.target.lat,
    data.target.lng,
    data.zoom,
    data.mapLogicalSize,
    MAP_SIDE
  );
  const cx = MAP_X + MAP_SIDE / 2;
  const cy = MAP_Y + MAP_SIDE / 2;

  // -- header --
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: HEADER_H, fill: { color: NAVY },
  });
  slide.addText("Target Property vs. Our Portfolio", {
    x: 0.4, y: 0.12, w: 9, h: 0.42, fontSize: 22, bold: true, color: WHITE,
  });
  slide.addText(
    [
      data.target.address,
      [data.target.city, data.target.market].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .join("  ·  "),
    { x: 0.4, y: 0.54, w: 9, h: 0.32, fontSize: 12, color: "C7D0DD" }
  );
  slide.addText(`Within ${data.radiusMiles} miles`, {
    x: SLIDE_W - 3.4, y: 0.3, w: 3, h: 0.4, fontSize: 12, color: "C7D0DD", align: "right",
  });

  // -- basemap, square and uncropped: the pin geometry depends on it --
  slide.addImage({
    data: data.imageBase64,
    x: MAP_X, y: MAP_Y, w: MAP_SIDE, h: MAP_SIDE,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: MAP_X, y: MAP_Y, w: MAP_SIDE, h: MAP_SIDE,
    fill: { type: "none" }, line: { color: HAIRLINE, width: 0.75 },
  });

  // -- distance rings, labelled on the way out --
  for (const mi of ringsFor(data.radiusMiles, geo.halfExtentMi)) {
    const r = mi * geo.inchesPerMile;
    if (r <= 0.05 || r > MAP_SIDE / 2) continue;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: cx - r, y: cy - r, w: r * 2, h: r * 2,
      fill: { type: "none" },
      line: { color: WHITE, width: 0.75, dashType: "dash", transparency: 35 },
    });
    slide.addText(`${mi} mi`, {
      x: cx - 0.35, y: cy - r - 0.17, w: 0.7, h: 0.22,
      fontSize: 7, color: WHITE, align: "center", bold: true,
    });
  }

  /** Draws a dot, clipped to the map so nothing spills onto the slide. */
  const dot = (lat: number, lng: number, color: string, size: number) => {
    const { dx, dy } = geo.offsetInches(lat, lng);
    const x = cx + dx;
    const y = cy + dy;
    const half = size / 2;
    if (x - half < MAP_X || x + half > MAP_X + MAP_SIDE) return;
    if (y - half < MAP_Y || y + half > MAP_Y + MAP_SIDE) return;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x - half, y: y - half, w: size, h: size,
      fill: { color }, line: { color: WHITE, width: 0.75 },
    });
  };

  // Comps first, then pipeline, then assets, then the target -- so the more
  // important thing is never hidden under the less important one.
  for (const c of data.comps) {
    dot(c.latitude, c.longitude, c.comp_type === "sale" ? SALE_GREEN : LEASE_BLUE, 0.09);
  }
  for (const d of data.pipeline) dot(d.latitude, d.longitude, "C9971F", 0.11);
  for (const a of data.assets) {
    dot(a.latitude, a.longitude, a.occupancy === "available" ? ASSET_AVAIL : ASSET_PURPLE, 0.15);
  }
  // The target: a ring around a dot, so it reads at a glance from the back of
  // a room.
  const t = geo.offsetInches(data.target.lat, data.target.lng);
  slide.addShape(pptx.ShapeType.ellipse, {
    x: cx + t.dx - 0.17, y: cy + t.dy - 0.17, w: 0.34, h: 0.34,
    fill: { type: "none" }, line: { color: TARGET_RED, width: 2.25 },
  });
  dot(data.target.lat, data.target.lng, TARGET_RED, 0.17);

  // -- right panel --
  let y = MAP_Y;
  const owned = data.assets.filter((a) => a.status !== "sold");
  const withSpace = owned.filter((a) => a.occupancy === "available");
  const nearest = owned[0];

  slide.addText("THE NUMBERS", {
    x: PANEL_X, y, w: PANEL_W, h: 0.26, fontSize: 9, bold: true, color: SUBTLE, charSpacing: 1.2,
  });
  y += 0.34;

  const stat = (label: string, value: string, note?: string) => {
    slide.addText(value, {
      x: PANEL_X, y, w: PANEL_W, h: 0.34, fontSize: 20, bold: true, color: INK,
    });
    slide.addText(label, {
      x: PANEL_X, y: y + 0.32, w: PANEL_W, h: 0.22, fontSize: 10, color: SUBTLE,
    });
    if (note) {
      slide.addText(note, {
        x: PANEL_X, y: y + 0.52, w: PANEL_W, h: 0.22, fontSize: 9, color: SUBTLE, italic: true,
      });
      y += 0.86;
    } else {
      y += 0.66;
    }
  };

  stat(
    "Assets we own within " + data.radiusMiles + " mi",
    String(owned.length),
    withSpace.length ? `${withSpace.length} with space available` : undefined
  );
  stat(
    "Nearest asset we own",
    nearest ? (nearest.distanceMi < 0.15 ? "This site" : `${nearest.distanceMi.toFixed(1)} mi`) : "—",
    nearest?.address
  );
  if (data.pipeline.length) {
    stat("Other live deals in radius", String(data.pipeline.length));
  }
  if (data.comps.length) {
    stat("Comps in radius", String(data.comps.length));
  }

  // -- nearest assets table --
  y += 0.1;
  slide.addText("NEAREST ASSETS", {
    x: PANEL_X, y, w: PANEL_W, h: 0.26, fontSize: 9, bold: true, color: SUBTLE, charSpacing: 1.2,
  });
  y += 0.32;

  const rows: any[][] = [
    [
      { text: "Asset", options: { bold: true, color: SUBTLE, fontSize: 9 } },
      { text: "Mi", options: { bold: true, color: SUBTLE, fontSize: 9, align: "right" } },
      { text: "AC", options: { bold: true, color: SUBTLE, fontSize: 9, align: "right" } },
      { text: "Status", options: { bold: true, color: SUBTLE, fontSize: 9 } },
    ],
  ];
  const maxRows = Math.max(1, Math.min(8, Math.floor((6.65 - y) / 0.3) - 1));
  for (const a of owned.slice(0, maxRows)) {
    rows.push([
      { text: `${a.address}${a.city ? `, ${a.city}` : ""}`.slice(0, 44), options: { fontSize: 9, color: INK } },
      { text: a.distanceMi < 0.15 ? "—" : a.distanceMi.toFixed(1), options: { fontSize: 9, color: INK, align: "right" } },
      { text: a.site_acres ? String(a.site_acres) : "—", options: { fontSize: 9, color: INK, align: "right" } },
      {
        text: a.occupancy === "available" ? "Space avail." : "Occupied",
        options: { fontSize: 9, color: a.occupancy === "available" ? "7B3FBF" : SUBTLE },
      },
    ]);
  }
  if (rows.length > 1) {
    slide.addTable(rows, {
      x: PANEL_X, y, w: PANEL_W,
      colW: [PANEL_W - 2.0, 0.55, 0.55, 0.9],
      border: { type: "solid", color: HAIRLINE, pt: 0.5 },
      rowH: 0.3,
      margin: 0.03,
      autoPage: false,
      valign: "middle",
    });
  } else {
    slide.addText(`No assets within ${data.radiusMiles} miles.`, {
      x: PANEL_X, y, w: PANEL_W, h: 0.3, fontSize: 10, color: SUBTLE, italic: true,
    });
  }

  // -- legend + provenance --
  const legendY = MAP_Y + MAP_SIDE + 0.16;
  const legend: [string, string][] = [
    ["Target property", TARGET_RED],
    ["Ours — occupied", ASSET_PURPLE],
    ["Ours — space available", ASSET_AVAIL],
    ...(data.pipeline.length ? ([["Live pipeline deals", "C9971F"]] as [string, string][]) : []),
    ...(data.comps.some((c) => c.comp_type === "lease")
      ? ([["Lease comps", LEASE_BLUE]] as [string, string][])
      : []),
    ...(data.comps.some((c) => c.comp_type === "sale")
      ? ([["Sale comps", SALE_GREEN]] as [string, string][])
      : []),
  ];
  let lx = MAP_X;
  for (const [label, color] of legend) {
    slide.addShape(pptx.ShapeType.ellipse, {
      x: lx, y: legendY + 0.045, w: 0.1, h: 0.1, fill: { color }, line: { color: WHITE, width: 0.5 },
    });
    slide.addText(label, {
      x: lx + 0.14, y: legendY, w: 1.75, h: 0.2, fontSize: 8, color: SUBTLE,
    });
    lx += 1.95;
  }

  // Acreage is blank on most assets, and a slide that doesn't say so implies
  // the portfolio is smaller than it is.
  const missingAcres = owned.filter((a) => a.site_acres == null).length;
  slide.addText(
    [
      `Straight-line distances from ${data.target.address}.`,
      missingAcres ? `${missingAcres} of ${owned.length} assets have no acreage recorded.` : null,
      owned.length > maxRows ? `Nearest ${maxRows} shown; CSV contains all results.` : null,
      "Portfolio from dalfen.com/ios.",
    ]
      .filter(Boolean)
      .join("  ")
      .trim(),
    { x: MAP_X, y: legendY + 0.24, w: SLIDE_W - 0.8, h: 0.22, fontSize: 8, color: SUBTLE, italic: true }
  );

  const safe = data.target.address.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  await pptx.writeFile({ fileName: `${safe}-vs-portfolio.pptx` });
}

/** The same comparison as a spreadsheet, for anyone who wants the numbers. */
export function portfolioMapCsv(data: PortfolioMapResponse): string {
  const esc = (v: unknown) => {
    const raw = v === null || v === undefined ? "" : String(v);
    const s = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  lines.push(`Target property,${esc(data.target.address)}`);
  lines.push(`Market,${esc(data.target.market ?? "")}`);
  lines.push(`Radius (miles),${data.radiusMiles === 0 ? "All" : data.radiusMiles}`);
  lines.push("");
  lines.push("Type,Address,City,Market,Distance (mi),Acres,Building SF,Status");
  for (const a of data.assets) {
    lines.push(
      [
        "Our asset", esc(a.address), esc(a.city ?? ""), esc(a.market ?? ""),
        a.distanceMi.toFixed(2), a.site_acres ?? "", a.building_sf ?? "",
        a.status === "sold" ? "sold" : a.occupancy === "available" ? "space available" : "occupied",
      ].join(",")
    );
  }
  for (const d of data.pipeline) {
    lines.push(
      ["Pipeline deal", esc(d.address), esc(d.city ?? ""), "", d.distanceMi.toFixed(2), "", "", esc(d.stage)].join(",")
    );
  }
  for (const c of data.comps) {
    lines.push(
      [`${c.comp_type} comp`, esc(c.address), "", "", c.distanceMi.toFixed(2), "", "", ""].join(",")
    );
  }
  return lines.join("\n");
}
