// lib/ic-deck/summary-slide.ts
//
// The one-page IC summary slide (design 2d). ONE model, TWO renderers:
// components/IcSlidePreview.tsx draws it in the browser and toPptx() below
// writes the same thing with pptxgenjs, both from lib/hopper-tokens. The
// preview is laid out at 900 x 506 px; the slide is 10 x 5.625 in, so every
// pptx coordinate is simply px / 90 and the two can't drift apart.
//
// The map is a static snapshot drawn from the same radius and categories
// (?r= & cats=) as the Demand Map tab: Esri satellite imagery with a road
// overlay (keyless, same source as the app's maps), then rings and pins.

import { color, signal, type SignalState } from "../hopper-tokens";
import type { CategoryRow, DemandHit, Flag } from "../site-score";
import { loadPptxScript } from "./iosDemandMap";

export interface SlideKpi {
  label: string;
  value: string;
  tone?: SignalState;
}

export interface SlidePin {
  x: number;
  y: number;
  color: string;
  inside: boolean;
}

export interface SummarySlideModel {
  eyebrow: string;
  title: string;
  kpis: SlideKpi[];
  flags: Flag[];
  recommendation: string;
  radius: number;
  demandRows: CategoryRow[];
  activeCats: string[];
  pins: SlidePin[];
  rings: Array<{ miles: number; r: number; on: boolean }>;
  /** Esri export URLs covering exactly the 300x220 map; null without a pin. */
  mapImages: { imagery: string; roads: string } | null;
  footerLeft: string;
  footerRight: string;
  fileName: string;
}

export const MAP_W = 300;
export const MAP_H = 220;
const PX_PER_MILE = 20; // fits the 5 mi ring in the 220 px map height

// Ring styling on top of satellite imagery (navy/grey vanish on dark photos).
export const RING_ON = "4E9FD6";
export const RING_OFF = "FFFFFF";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const EARTH_R = 6378137;

/**
 * Esri MapServer export URLs for exactly the slide map's extent, at 2x for
 * sharpness. Web Mercator bbox, so the image matches the pin projection below
 * (locally linear, 20 px per ground mile in both axes).
 */
export function slideMapImages(center: { lat: number; lng: number } | null) {
  if (!center) return null;
  const rad = Math.PI / 180;
  const x = EARTH_R * center.lng * rad;
  const y = EARTH_R * Math.log(Math.tan(Math.PI / 4 + (center.lat * rad) / 2));
  const k = 1609.34 / Math.cos(center.lat * rad); // mercator metres per ground mile
  const hw = (MAP_W / 2 / PX_PER_MILE) * k;
  const hh = (MAP_H / 2 / PX_PER_MILE) * k;
  const q = `bbox=${Math.round(x - hw)},${Math.round(y - hh)},${Math.round(x + hw)},${Math.round(y + hh)}&bboxSR=3857&imageSR=3857&size=${MAP_W * 2},${MAP_H * 2}&f=image`;
  return {
    imagery: `${ESRI}/World_Imagery/MapServer/export?${q}&format=jpg`,
    roads: `${ESRI}/Reference/World_Transportation/MapServer/export?${q}&format=png32&transparent=true`,
  };
}

/** Project tenants onto the 300x220 slide map, centred on the subject. */
export function slideMap(center: { lat: number; lng: number } | null, tenants: DemandHit[], radius: number, catColor: (label: string) => string | null) {
  const rings = [1, 3, 5].map((m) => ({ miles: m, r: m * PX_PER_MILE, on: m === radius }));
  if (!center) return { rings, pins: [] as SlidePin[] };
  const kx = 69.17 * Math.cos((center.lat * Math.PI) / 180);
  const pins = tenants
    .map((t) => {
      const c = catColor(t.category);
      if (!c) return null;
      const x = MAP_W / 2 + (t.lng - center.lng) * kx * PX_PER_MILE;
      const y = MAP_H / 2 - (t.lat - center.lat) * 69.17 * PX_PER_MILE;
      if (x < 4 || x > MAP_W - 4 || y < 4 || y > MAP_H - 4) return null;
      return { x, y, color: c, inside: t.distanceMi <= radius };
    })
    .filter(Boolean) as SlidePin[];
  return { rings, pins };
}

// ---- pptx --------------------------------------------------------------------

const IN = (px: number) => px / 90;

async function dataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function toPptx(m: SummarySlideModel) {
  await loadPptxScript();
  const PptxGenJS = (window as any).PptxGenJS;
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9"; // 10 x 5.625 in
  pres.title = m.title;
  const s = pres.addSlide();
  s.background = { color: color.white };
  const DISPLAY = "Arial";
  const MONO = "Consolas";
  const rect = (x: number, y: number, w: number, h: number, fill: string, line?: string, radius?: number) =>
    s.addShape(radius ? "roundRect" : "rect", {
      x: IN(x),
      y: IN(y),
      w: IN(w),
      h: IN(h),
      fill: { color: fill },
      line: line ? { color: line, width: 0.75 } : { type: "none" },
      ...(radius ? { rectRadius: 0.04 } : {}),
    });
  const text = (t: string, x: number, y: number, w: number, h: number, o: any = {}) =>
    s.addText(t, { x: IN(x), y: IN(y), w: IN(w), h: IN(h), margin: 0, fontFace: o.mono ? MONO : DISPLAY, valign: "top", ...o });

  // Title bar
  rect(0, 0, 900, 70, color.navy);
  text(m.eyebrow.toUpperCase(), 28, 15, 700, 12, { fontSize: 7.5, bold: true, color: color.sky, charSpacing: 1.5 });
  text(m.title, 28, 32, 700, 28, { fontSize: 18, bold: true, color: color.white });
  text("DALFEN", 760, 26, 112, 20, { fontSize: 11, bold: true, color: color.white, align: "right", charSpacing: 3 });

  // KPI tiles: 5 across a 544 px column
  const colW = 900 - 56 - 300 - 20;
  const kw = (colW - 8 * 4) / 5;
  m.kpis.forEach((k, i) => {
    const x = 28 + i * (kw + 8);
    const sig = k.tone ? signal[k.tone] : null;
    rect(x, 88, kw, 52, sig ? sig.bg : color.white, sig ? sig.fg : color.border, 4);
    text(k.label.toUpperCase(), x + 10, 98, kw - 16, 10, { fontSize: 6, bold: true, color: sig ? sig.fg : color.textMuted, charSpacing: 1 });
    text(k.value, x + 10, 112, kw - 16, 22, { fontSize: 13.5, bold: true, color: sig ? sig.fg : color.navy, mono: true });
  });

  // Viability flags, 3 x 2
  text("SITE VIABILITY", 28, 154, 200, 10, { fontSize: 7, bold: true, color: color.navy, charSpacing: 1.5 });
  const fw = (colW - 12) / 3;
  m.flags.forEach((f, i) => {
    const x = 28 + (i % 3) * (fw + 6);
    const y = 170 + Math.floor(i / 3) * 64;
    const sig = signal[f.state];
    rect(x, y, fw, 58, sig.bg, undefined, 3);
    rect(x, y, fw, 3, sig.fg);
    text(f.label, x + 9, y + 10, fw - 60, 12, { fontSize: 8, bold: true, color: color.textStrong });
    text(sig.label.toUpperCase(), x + fw - 60, y + 11, 51, 10, { fontSize: 5.5, bold: true, color: sig.fg, align: "right", charSpacing: 1 });
    text(f.note, x + 9, y + 26, fw - 18, 28, { fontSize: 7, color: color.textBody, fontFace: DISPLAY });
  });

  // Recommendation
  rect(28, 310, colW, 92, color.canvas, undefined, 3);
  text("RECOMMENDATION", 40, 320, 300, 10, { fontSize: 6, bold: true, color: color.brand, charSpacing: 1.5 });
  text(m.recommendation || "—", 40, 335, colW - 24, 62, { fontSize: 8.5, color: color.n800 });

  // Map snapshot
  const mx = 900 - 28 - MAP_W;
  const my = 88;
  rect(mx, my, MAP_W, MAP_H, "E6ECF1", undefined, 3);
  // Embedded, not linked, so the deck opens offline and never changes later.
  if (m.mapImages) {
    const [imagery, roads] = await Promise.all([dataUrl(m.mapImages.imagery), dataUrl(m.mapImages.roads)]);
    for (const data of [imagery, roads]) {
      if (data) s.addImage({ data, x: IN(mx), y: IN(my), w: IN(MAP_W), h: IN(MAP_H) });
    }
  }
  for (const r of m.rings) {
    s.addShape("ellipse", {
      x: IN(mx + MAP_W / 2 - r.r),
      y: IN(my + MAP_H / 2 - r.r),
      w: IN(r.r * 2),
      h: IN(r.r * 2),
      fill: r.on ? { color: RING_ON, transparency: 88 } : { type: "none" },
      line: { color: r.on ? RING_ON : RING_OFF, width: r.on ? 2 : 0.75, dashType: r.on ? "solid" : "dash", transparency: r.on ? 0 : 30 },
    });
  }
  for (const p of m.pins) {
    s.addShape("ellipse", {
      x: IN(mx + p.x - 3.5),
      y: IN(my + p.y - 3.5),
      w: IN(7),
      h: IN(7),
      fill: { color: p.color, transparency: p.inside ? 0 : 72 },
      line: { color: color.white, width: 0.5 },
    });
  }
  s.addShape("diamond", {
    x: IN(mx + MAP_W / 2 - 7),
    y: IN(my + MAP_H / 2 - 7),
    w: IN(14),
    h: IN(14),
    fill: { color: color.navy },
    line: { color: color.white, width: 1.5 },
  });

  // Demand bars
  text(`TENANT DEMAND · ${m.radius} MI`, mx, my + MAP_H + 12, MAP_W, 10, { fontSize: 7, bold: true, color: color.navy, charSpacing: 1.5 });
  m.demandRows.slice(0, 7).forEach((r, i) => {
    const y = my + MAP_H + 30 + i * 13;
    const on = m.activeCats.includes(r.key);
    text(r.label, mx, y, 110, 10, { fontSize: 7, color: on ? color.n800 : color.n400 });
    rect(mx + 116, y + 3, 150, 4, color.muted100);
    if (r.share > 0) rect(mx + 116, y + 3, Math.max(1, 150 * r.share), 4, on ? r.color : color.n400);
    text(String(r.count), mx + 270, y, 30, 10, { fontSize: 7, color: color.textStrong, align: "right", mono: true });
  });

  // Footer
  s.addShape("line", { x: 0, y: IN(480), w: 10, h: 0, line: { color: color.border, width: 0.75 } });
  text(m.footerLeft, 28, 488, 500, 10, { fontSize: 6.5, color: color.textMuted });
  text(m.footerRight, 430, 488, 442, 10, { fontSize: 6.5, color: color.textMuted, align: "right", mono: true });

  await pres.writeFile({ fileName: m.fileName });
}

