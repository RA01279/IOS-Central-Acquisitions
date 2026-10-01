import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
nextEnv.loadEnvConfig(process.cwd());
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const report = JSON.parse(readFileSync("docs/map-location-audit.json", "utf8"));
const output = [];
for (const row of report.unresolved) {
  const [{data: comps,error}, {data: props,error: pError}] = await Promise.all([
    db.from("comps").select("address,city,state,latitude,longitude,geocode_precision").ilike("address", `${row.address.split(" ")[0]}%`),
    db.from("properties").select("address,city,market,latitude,longitude,geocode_precision").ilike("address", `${row.address.split(" ")[0]}%`),
  ]);
  if (error || pError) throw new Error((error || pError).message);
  const evidence = [];
  for (const deal of row.deals) {
    const {data: activities,error: aError} = await db.from("activities").select("*").eq("deal_id",deal.id);
    if (aError) throw new Error(aError.message);
    evidence.push(...activities);
  }
  output.push({id:row.id,address:row.address,city:row.city,comps,properties:props.filter(p=>p.address!==row.address),activities:evidence});
}
writeFileSync("docs/location-source-evidence.json",JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
