// lib/market-owners.ts
//
// Who covers each market. A new deal in a covered market defaults to that
// person as owner (still changeable on the deal); elsewhere the creator owns
// it. Kept in app_settings ('market_owners' = {"atlanta": "email", ...}) so a
// market can be reassigned without a deploy.

import { cache } from "react";
import { getServiceClient } from "./supabase";
import { canonicalMarket } from "./markets";

export const marketOwners = cache(async (): Promise<Record<string, string>> => {
  const { data } = await getServiceClient().from("app_settings").select("value").eq("key", "market_owners").maybeSingle();
  try {
    const raw = typeof data?.value === "string" ? JSON.parse(data.value) : data?.value;
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === "string").map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  } catch {
    return {};
  }
});

/** The owner a new deal in this market should start with. */
export async function defaultOwner(market: unknown, city: unknown, creator: string): Promise<string> {
  const m = canonicalMarket(market, city)?.toLowerCase();
  const owners = await marketOwners();
  return (m && owners[m]) || creator.toLowerCase();
}
