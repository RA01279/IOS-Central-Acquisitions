import type { Point } from "./types";
export type Polygon = { rings: number[][][] };
export function validPoint(p: Point): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}
// Even/odd rings support holes and disjoint municipal areas. Edge points
// intersect both adjacent zoning polygons and are flagged as ambiguous.
export function containsPoint(p: Point, polygon: Polygon): boolean {
  let inside = false;
  for (const ring of polygon.rings ?? []) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x, y] = ring[i], [x2, y2] = ring[j];
      const dx=x2-x, dy=y2-y, cross=(p.lng-x)*dy-(p.lat-y)*dx;
      if ((dx !== 0 || dy !== 0) && Math.abs(cross) < 1e-12 &&
          p.lng >= Math.min(x,x2)-1e-10 && p.lng <= Math.max(x,x2)+1e-10 &&
          p.lat >= Math.min(y,y2)-1e-10 && p.lat <= Math.max(y,y2)+1e-10) return true;
      if ((y > p.lat) !== (y2 > p.lat) && p.lng < (x2-x)*(p.lat-y)/(y2-y)+x) inside = !inside;
    }
  }
  return inside;
}
export function distanceMiles(a: Point, b: Point): number {
  const r=Math.PI/180, dLat=(b.lat-a.lat)*r, dLng=(b.lng-a.lng)*r;
  const h=Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;
  return 3958.7613*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
