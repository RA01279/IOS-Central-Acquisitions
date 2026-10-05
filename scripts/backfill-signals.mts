// scripts/backfill-signals.mts
// Computes the free site-viability flags (zoning, access, flood, basis, rent)
// for every active acquisition. Skips the Google Places demand search, which
// costs money -- run that per deal from the Demand Map tab.
//   npx tsx --env-file=.env.local scripts/backfill-signals.mts [--limit N] [--retry]
// --retry only re-runs deals where a public service was unavailable last time.
import { getServiceClient } from "../lib/supabase.ts";
import { refreshSignals } from "../lib/site-signals.ts";

const limit = Number(process.argv[process.argv.indexOf("--limit") + 1]) || 1000;
let retryIds: string[] | null = null;
if (process.argv.includes("--retry")) {
  const { data: failed } = await getServiceClient().from("deal_signals").select("deal_id").like("auto_note", "%refresh to retry%");
  retryIds = [...new Set((failed ?? []).map((r: any) => r.deal_id))];
}
let query = getServiceClient()
  .from("deals")
  .select("id, properties(address)")
  .eq("deal_type", "acquisition")
  .not("stage", "in", "(archived,closed)")
  .limit(limit);
if (retryIds) query = query.in("id", retryIds);
const { data } = await query;
for (const d of data ?? []) {
  const errors = await refreshSignals(d.id, { skipDemand: true });
  console.log((d.properties as any)?.address ?? d.id, errors.length ? errors : "ok");
}
