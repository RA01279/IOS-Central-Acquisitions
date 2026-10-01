// Read-only diagnosis of recent Austin lease comps. Never prints credentials.
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
nextEnv.loadEnvConfig(process.cwd());
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await db.from("comps")
  .select("id,address,city,state,market,asset_class,comp_type,status,latitude,longitude,geocode_precision,created_at,source,source_ref")
  .order("created_at", { ascending: false }).limit(15);
if (error) { console.error(error.message); process.exit(1); }
console.log(JSON.stringify(data, null, 2));
