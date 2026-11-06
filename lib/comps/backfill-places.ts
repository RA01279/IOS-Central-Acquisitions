// lib/comps/backfill-places.ts
//
// SERVER ONLY. Fills a blank market or submarket on saved comps from their
// pins (lib/comps/auto-location). Run daily by /api/cron/comp-places: the
// first run backfills comps saved before this existed, and later runs catch
// any that saved while ArcGIS was unreachable. Never overwrites a value.

import { placeComps } from "@/lib/comps/auto-location";
import { readAllCompPages } from "@/lib/comps/mapData";
import { invalidateComps } from "@/lib/comps/cache";

export interface BackfillResult { checked: number; market: number; submarket: number; failed: number }

export async function backfillCompPlaces(supabase: any, limit = 400): Promise<BackfillResult> {
  const rows = await readAllCompPages<any>((from, to) =>
    supabase.from("comps")
      .select("id, market, submarket, city, latitude, longitude, is_portfolio, status")
      .or("market.is.null,submarket.is.null")
      .not("latitude", "is", null)
      .neq("status", "rejected")
      .order("id").range(from, to));
  const todo = rows.filter((r) => !r.is_portfolio).slice(0, limit);
  const places = await placeComps(todo);
  const result: BackfillResult = { checked: todo.length, market: 0, submarket: 0, failed: 0 };
  for (let i = 0; i < todo.length; i++) {
    const r = todo[i], p = places[i];
    const update: Record<string, string> = {};
    if (!r.market && p.market) update.market = p.market;
    if (!r.submarket && p.submarket) update.submarket = p.submarket;
    if (!Object.keys(update).length) continue;
    // Only where still blank, so an edit made meanwhile isn't overwritten.
    let q = supabase.from("comps").update(update).eq("id", r.id);
    if (update.market) q = q.is("market", null);
    if (update.submarket) q = q.is("submarket", null);
    const { error } = await q;
    if (error) { result.failed++; continue; }
    if (update.market) result.market++;
    if (update.submarket) result.submarket++;
  }
  if (result.market || result.submarket) invalidateComps();
  return result;
}
