// lib/comps/cache.ts
//
// The confirmed-comp evidence is read on every Financials, Demand Map,
// portfolio and IC-deck render, and changes only when someone saves, edits,
// deletes or merges a comp. It's cached under one tag; every comp write calls
// invalidateComps() so the next read is fresh. The 5-minute expiry covers
// writes from outside the app (scripts, the SQL editor).

import { revalidateTag } from "next/cache";

export const COMPS_TAG = "comps";
export const COMPS_TTL_SECONDS = 300;

export function invalidateComps() {
  try {
    revalidateTag(COMPS_TAG);
  } catch {
    // Outside a request (tests, scripts) there's no cache to clear.
  }
}
