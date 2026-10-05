// scripts/backfill-signals.mts
// Computes the free site-viability flags (zoning, access, flood, basis, rent)
// for every active acquisition. Skips the Google Places demand search, which
// costs money -- run that per deal from the Demand Map tab.
//   npx tsx --env-file=.env.local scripts/backfill-signals.mts [--limit N]
import { getServiceClient } from "../lib/supabase.ts";
import { refreshSignals } from "../lib/site-signals.ts";

const limit = Number(process.argv[process.argv.indexOf("--limit") + 1]) || 1000;
const { data } = await getServiceClient()
  .from("deals")
  .select("id, properties(address)")
  .eq("deal_type", "acquisition")
  .not("stage", "in", "(archived,closed)")
  .limit(limit);
for (const d of data ?? []) {
  const errors = await refreshSignals(d.id, { skipDemand: true });
  console.log((d.properties as any)?.address ?? d.id, errors.length ? errors : "ok");
}
