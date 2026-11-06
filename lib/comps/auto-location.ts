// lib/comps/auto-location.ts
//
// SERVER ONLY. Market and submarket for a comp come from where it is, so
// nobody has to type them. What was typed (or read off the broker's sheet)
// still wins; this only fills blanks:
//   market    -- typed, else the city, else the nearest metro to the pin (lib/markets)
//   submarket -- typed, else the Dalfen submarket of the inventoried IOS
//                properties around the pin (ArcGIS, lib/ic-deck/canvas)

import { resolveMarket } from "@/lib/markets";
import { submarketAt } from "@/lib/ic-deck/canvas";

export interface CompPlace {
  market: string | null;
  submarket: string | null;
}

const blank = (v: unknown) => v == null || String(v).trim() === "";

/** Market and submarket for one comp, blanks filled from its pin. */
export async function placeComp(c: { market?: unknown; submarket?: unknown; city?: unknown; latitude?: unknown; longitude?: unknown }): Promise<CompPlace> {
  const market = resolveMarket(c.market, c.city, c.latitude, c.longitude);
  let submarket = blank(c.submarket) ? null : String(c.submarket).trim();
  const lat = Number(c.latitude), lng = Number(c.longitude);
  if (!submarket && !blank(c.latitude) && !blank(c.longitude) && Number.isFinite(lat) && Number.isFinite(lng)) {
    submarket = await submarketAt(lat, lng);
  }
  return { market, submarket };
}

/** placeComp for many comps, a few ArcGIS lookups in flight at a time, results in order. */
export async function placeComps(items: Array<Parameters<typeof placeComp>[0]>, limit = 4): Promise<CompPlace[]> {
  const out: CompPlace[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await placeComp(items[i]);
    }
  }));
  return out;
}
