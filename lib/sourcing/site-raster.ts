// lib/sourcing/site-raster.ts
//
// The grid steps of the net-usable-acres measurement (lib/sourcing/usable-acres):
//  - steep ground: USGS 3DEP bare-earth elevation (1 m lidar where flown)
//    sampled on a grid across the parcel; ground over a 5% grade is costly to
//    grade for truck and container storage;
//  - narrow strips: whatever is left that is under ~60 ft wide cannot hold a
//    truck turn or a parking row (a morphological opening of the usable area).
// Everything runs on a local metre grid about the parcel centre; polygons are
// rasterised by scanline, distances by a two-pass chamfer transform.

import type { MultiPolygon } from "polygon-clipping";

export const STEEP_GRADE = 0.05;
/** Steep patches smaller than this (dock wells, pads, ditches) are not a grading problem for a yard. */
export const MIN_STEEP_SQM = 2000;
/** Narrower than this (≈ 60 ft) is not usable for trucks or parking rows. */
export const MIN_WIDTH_M = 18;
export const DEM = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples";
const R = 6378137;

export interface Frame { lat0: number; lng0: number; kx: number; ky: number }
export const frameAt = (lat0: number, lng0: number): Frame => ({ lat0, lng0, kx: (R * Math.PI / 180) * Math.cos(lat0 * Math.PI / 180), ky: R * Math.PI / 180 });
const toXY = (f: Frame, p: number[]) => [(p[0] - f.lng0) * f.kx, (p[1] - f.lat0) * f.ky];

/** A grid of cells (row-major, one cell of empty padding all round). */
export interface Mask { x0: number; y0: number; cell: number; w: number; h: number; on: Uint8Array }

export function rasterize(geom: MultiPolygon, f: Frame, maxCells = 200000, cell?: number): Mask {
  const rings = geom.flatMap((p) => p).map((r) => r.map((pt) => toXY(f, pt)));
  if (!rings.length) return { x0: 0, y0: 0, cell: cell ?? 1, w: 0, h: 0, on: new Uint8Array(0) };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const size = cell ?? Math.max(1.5, Math.sqrt(((maxX - minX) * (maxY - minY)) / maxCells));
  const x0 = minX - size, y0 = minY - size;
  const w = Math.ceil((maxX - minX) / size) + 3, h = Math.ceil((maxY - minY) / size) + 3;
  const on = new Uint8Array(w * h);
  for (let j = 1; j < h - 1; j++) {
    const y = y0 + (j + 0.5) * size, xs: number[] = [];
    for (const r of rings) for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
      const [x1, y1] = r[k], [x2, y2] = r[i];
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let n = 0; n + 1 < xs.length; n += 2) {
      const a = Math.ceil((xs[n] - x0) / size - 0.5), b = Math.floor((xs[n + 1] - x0) / size - 0.5);
      for (let i = Math.max(1, a); i <= Math.min(w - 2, b); i++) on[j * w + i] = 1;
    }
  }
  return { x0, y0, cell: size, w, h, on };
}

export const count = (a: Uint8Array) => { let n = 0; for (let i = 0; i < a.length; i++) n += a[i]; return n; };

/** Chamfer distance (in cells) from every cell to the nearest cell where `target` is set. */
function distanceTo(target: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h), D = Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = target[i] ? 0 : 1e9;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i; let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + 1);
    if (j > 0) { v = Math.min(v, d[k - w] + 1); if (i > 0) v = Math.min(v, d[k - w - 1] + D); if (i < w - 1) v = Math.min(v, d[k - w + 1] + D); }
    d[k] = v;
  }
  for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
    const k = j * w + i; let v = d[k];
    if (i < w - 1) v = Math.min(v, d[k + 1] + 1);
    if (j < h - 1) { v = Math.min(v, d[k + w] + 1); if (i < w - 1) v = Math.min(v, d[k + w + 1] + D); if (i > 0) v = Math.min(v, d[k + w - 1] + D); }
    d[k] = v;
  }
  return d;
}

/** Cells of `on` that sit in a part at least `widthM` wide (erode by half the width, then grow back). */
export function wideEnough(on: Uint8Array, m: Mask, widthM = MIN_WIDTH_M): Uint8Array {
  const r = widthM / 2 / m.cell;
  const outside = new Uint8Array(on.length);
  for (let i = 0; i < on.length; i++) outside[i] = on[i] ? 0 : 1;
  const toEdge = distanceTo(outside, m.w, m.h);
  const core = new Uint8Array(on.length);
  for (let i = 0; i < on.length; i++) core[i] = on[i] && toEdge[i] > r ? 1 : 0;
  const toCore = distanceTo(core, m.w, m.h);
  const kept = new Uint8Array(on.length);
  for (let i = 0; i < on.length; i++) kept[i] = on[i] && toCore[i] <= r + 0.5 ? 1 : 0;
  return kept;
}

/** Elevation nodes on a regular grid (spacing in metres) over a mask's extent. */
export interface Terrain { x0: number; y0: number; step: number; nx: number; ny: number; steep: Uint8Array }

/**
 * Sample bare-earth elevation over the mask and flag nodes steeper than
 * STEEP_GRADE. Null when the elevation service gives too little back.
 */
export async function sampleTerrain(m: Mask, f: Frame, fetcher: typeof fetch, maxPoints = 450): Promise<Terrain | null> {
  const W = m.w * m.cell, H = m.h * m.cell;
  const step = Math.max(20, Math.sqrt((W * H) / maxPoints));
  const nx = Math.max(2, Math.ceil(W / step) + 1), ny = Math.max(2, Math.ceil(H / step) + 1);
  const pts: number[][] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts.push([f.lng0 + (m.x0 + i * step) / f.kx, f.lat0 + (m.y0 + j * step) / f.ky]);
  const z = new Float64Array(pts.length).fill(NaN);
  const chunks: number[] = []; for (let s = 0; s < pts.length; s += 500) chunks.push(s);
  await Promise.all(chunks.map(async (start) => {
    const body = new URLSearchParams({ geometry: JSON.stringify({ points: pts.slice(start, start + 500), spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryMultipoint", returnFirstValueOnly: "true", interpolation: "RSP_BilinearInterpolation", f: "json" });
    for (const wait of [0, 1500]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        const r = await fetcher(DEM, { method: "POST", body, signal: AbortSignal.timeout(25000) } as RequestInit);
        const j = await r.json();
        if (!Array.isArray(j?.samples)) continue;
        for (const s of j.samples) { const v = Number(s.value); if (Number.isFinite(v) && v > -500) z[start + Number(s.locationId)] = v; }
        return;
      } catch { /* retry once */ }
    }
  }));
  let got = 0; for (const v of z) if (Number.isFinite(v)) got++;
  if (got < pts.length * 0.8) return null;
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= ny ? NaN : z[j * nx + i]);
  // Horn's 3x3 slope (a smoothed plane fit) per node; edges reuse the centre value.
  const zz = (i: number, j: number, c: number) => { const v = at(i, j); return Number.isFinite(v) ? v : c; };
  const raw = new Uint8Array(pts.length);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = at(i, j); if (!Number.isFinite(c)) continue;
    const a = zz(i - 1, j + 1, c), b = zz(i, j + 1, c), cc = zz(i + 1, j + 1, c), d = zz(i - 1, j, c), f2 = zz(i + 1, j, c), g = zz(i - 1, j - 1, c), h = zz(i, j - 1, c), k = zz(i + 1, j - 1, c);
    const dx = ((cc + 2 * f2 + k) - (a + 2 * d + g)) / (8 * step), dy = ((a + 2 * b + cc) - (g + 2 * h + k)) / (8 * step);
    raw[j * nx + i] = Math.hypot(dx, dy) > STEEP_GRADE ? 1 : 0;
  }
  // Keep only connected steep areas of at least MIN_STEEP_SQM.
  const steep = new Uint8Array(pts.length), seen = new Uint8Array(pts.length), minNodes = Math.ceil(MIN_STEEP_SQM / (step * step));
  for (let s0 = 0; s0 < raw.length; s0++) {
    if (!raw[s0] || seen[s0]) continue;
    const group = [s0]; seen[s0] = 1;
    for (let q = 0; q < group.length; q++) {
      const n = group[q], i = n % nx, j = (n - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj, m2 = jj * nx + ii;
        if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && raw[m2] && !seen[m2]) { seen[m2] = 1; group.push(m2); }
      }
    }
    if (group.length >= minNodes) for (const n of group) steep[n] = 1;
  }
  return { x0: m.x0, y0: m.y0, step, nx, ny, steep };
}

/** The cells of `m` that fall on steep terrain nodes. */
export function steepCells(m: Mask, t: Terrain): Uint8Array {
  const out = new Uint8Array(m.on.length);
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    const k = j * m.w + i; if (!m.on[k]) continue;
    const x = m.x0 + (i + 0.5) * m.cell, y = m.y0 + (j + 0.5) * m.cell;
    const ti = Math.round((x - t.x0) / t.step), tj = Math.round((y - t.y0) / t.step);
    if (ti >= 0 && tj >= 0 && ti < t.nx && tj < t.ny && t.steep[tj * t.nx + ti]) out[k] = 1;
  }
  return out;
}
