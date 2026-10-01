// scripts/report-duplicate-properties.mjs
// Read-only: lists properties that share a normalized address + city, with the
// deals and assets hanging off each, so duplicates can be merged deliberately.
// Usage: node scripts/report-duplicate-properties.mjs
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const ref = new URL(env.SUPABASE_URL).hostname.split(".")[0];
const query = `
with norm as (
  select p.*, lower(regexp_replace(address,'[^a-zA-Z0-9]','','g')) a, lower(coalesce(city,'')) c from properties p
), groups as (select a, c from norm group by a, c having count(*) > 1)
select n.a || '|' || n.c as grp, n.id, n.address, n.city, n.market, n.created_at::date as created,
  (n.latitude is not null) as located,
  (select string_agg(d.stage || ':' || left(d.id::text, 8), ', ') from deals d where d.property_id = n.id) as deals,
  (select count(*) from deals d where d.property_id = n.id and d.portfolio_asset_id is not null) as assets
from norm n join groups g using (a, c)
order by grp, n.created_at`;
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query, read_only: true }),
});
if (!res.ok) { console.error(`HTTP ${res.status}: ${await res.text()}`); process.exit(1); }
let last;
for (const r of await res.json()) {
  if (r.grp !== last) { console.log(`\n${r.address}, ${r.city ?? "(no city)"}`); last = r.grp; }
  console.log(`  ${r.id.slice(0, 8)}  created ${r.created}  ${r.located ? "located " : "no pin  "}  assets ${r.assets}  deals: ${r.deals ?? "none"}`);
}
