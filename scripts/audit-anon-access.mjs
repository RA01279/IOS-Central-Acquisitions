// scripts/audit-anon-access.mjs
//
// Read-only check that the browser (anon) key can't read any table. Lists
// every table PostgREST exposes and tries one row with the anon key.
//   node scripts/audit-anon-access.mjs   (needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY)
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !service || !anon) { console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY."); process.exit(2); }

const spec = await (await fetch(`${url}/rest/v1/`, { headers: { apikey: service, Authorization: `Bearer ${service}` } })).json();
const tables = Object.keys(spec.definitions ?? {}).sort();
const leaks = [], reachable = [];
for (const t of tables) {
  const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
  if (r.status !== 200) continue;
  const rows = await r.json().catch(() => []);
  (Array.isArray(rows) && rows.length ? leaks : reachable).push(t);
}
console.log(`${tables.length} tables checked.`);
if (reachable.length) console.log(`Granted to anon but RLS hides every row: ${reachable.join(", ")}`);
if (leaks.length) { console.log(`READABLE WITH THE BROWSER KEY: ${leaks.join(", ")}`); process.exit(1); }
console.log("No table returns rows to the anon key.");
