// Runs the migration and lifecycle assertions in one rolled-back transaction.
import nextEnv from "@next/env";
import { readFileSync } from "node:fs";
nextEnv.loadEnvConfig(process.cwd());
const migration = readFileSync(new URL("../supabase/migrations/20260909171325_closed_deal_assets.sql", import.meta.url), "utf8");
const tests = `
do $$
declare p uuid; d uuid; a uuid; initial_count int; label text := 'Lifecycle test ' || gen_random_uuid();
begin
  insert into public.properties(address,city,asset_type,latitude,longitude,geocode_precision,lot_sf)
    values(label,'Houston','ios',29.9,-95.5,'rooftop',87120) returning id into p;
  insert into public.deals(property_id,deal_type,stage,created_by) values(p,'acquisition','prospect','lifecycle-test') returning id into d;
  select count(*) into initial_count from public.assets;
  update public.deals set stage='moving_to_psa' where id=d;
  if (select count(*) from public.assets) <> initial_count then raise exception 'PSA promoted too early'; end if;
  update public.deals set stage='due_diligence' where id=d;
  update public.deals set stage='closed',closed_on=current_date,closed_price=100 where id=d;
  select portfolio_asset_id into a from public.deals where id=d;
  if a is null or not exists(select 1 from public.assets where id=a and status='owned' and site_acres=2 and latitude=29.9) then raise exception 'Closing did not copy property'; end if;
  update public.deals set stage='closed' where id=d;
  if (select count(*) from public.assets) <> initial_count+1 then raise exception 'Repeated close duplicated asset'; end if;
  update public.deals set stage='due_diligence',closed_on=null,closed_price=null where id=d;
  if not exists(select 1 from public.assets where id=a and status='under_contract') then raise exception 'Reopen retained owned status'; end if;
  update public.deals set stage='closed',closed_on=current_date,closed_price=100 where id=d;
  if (select portfolio_asset_id from public.deals where id=d) <> a then raise exception 'Reclose changed asset'; end if;
  update public.properties set latitude=29.95 where id=p;
  if not exists(select 1 from public.assets where id=a and latitude=29.95) then raise exception 'Location correction did not propagate'; end if;
  -- A second deal at an already-owned address reuses the asset and must not remove it on correction.
  insert into public.deals(property_id,deal_type,stage,created_by,closed_on,closed_price) values(p,'acquisition','closed','lifecycle-test',current_date,100) returning id into d;
  if (select portfolio_asset_id from public.deals where id=d) <> a then raise exception 'Address match duplicated asset'; end if;
  update public.deals set stage='prospect' where id=d;
  if not exists(select 1 from public.assets where id=a and status='owned') then raise exception 'Reopen removed prior ownership'; end if;
end $$;
select 'Lifecycle assertions passed; all test changes rolled back' as result;
rollback;`;
const ref = new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: process.argv.includes("--verify")
    ? "select (select count(*) from pg_trigger where tgname in ('sync_closed_deal_asset','sync_closed_property_location') and not tgisinternal) as installed_triggers, count(*) as closed_deals, count(portfolio_asset_id) as linked_assets from public.deals where stage='closed' and deal_type='acquisition';"
    : migration.replace(/commit;\s*$/i, () => tests) }),
});
console.log(await res.text());
if (!res.ok) process.exitCode = 1;
