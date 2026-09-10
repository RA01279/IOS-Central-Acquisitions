// Read-only platform audit. Reports counts and access configuration, never keys or message bodies.
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => [l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]));
const ref = new URL(env.SUPABASE_URL).hostname.split('.')[0];
const queries = {
  access: `select c.relname, c.relrowsecurity as rls, has_table_privilege('anon',c.oid,'SELECT') as anon_read, has_table_privilege('anon',c.oid,'INSERT') as anon_insert, has_table_privilege('authenticated',c.oid,'UPDATE') as member_update from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname`,
  policies: `select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','storage')`,
  columns: `select table_name,column_name from information_schema.columns where table_schema='public' and table_name in ('owned_assets','comps','properties') order by table_name,ordinal_position`,
  deals: `select stage,asset_class,count(*) as count,count(*) filter(where property_id is null) as missing_property,count(*) filter(where assigned_analyst is null) as unassigned,count(*) filter(where stage='closed' and (closed_price is null or closed_on is null)) as incomplete_closing,count(*) filter(where stage in ('moving_to_psa','due_diligence') and contract_price is null) as missing_contract_price,count(*) filter(where stage='due_diligence' and dd_end_on is null) as missing_dd_date from deals where deal_type='acquisition' group by stage,asset_class order by stage,asset_class`,
  locations: `select count(*) as total,count(*) filter(where latitude is null or longitude is null) as unlocated,count(*) filter(where city is null or trim(city)='') as no_city,count(*) filter(where asset_type is null) as no_type from properties`,
  duplicates: `select count(*) as repeated_address_city_groups,coalesce(sum(n-1),0) as excess_property_rows from (select count(*) n from properties group by lower(regexp_replace(address,'[^a-zA-Z0-9]','','g')),lower(coalesce(city,'')) having count(*)>1) s`,
  buckets: `select id,public,file_size_limit,allowed_mime_types from storage.buckets`,
  checks: `select conname,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.deals'::regclass and contype='c'`,
  triggers: `select c.relname,t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal`,
  maps: `select 'active_deals' as category,count(*) total,count(*) filter(where p.latitude is null or p.longitude is null) unlocated from deals d join properties p on p.id=d.property_id where d.deal_type='acquisition' and d.stage not in ('archived','closed') union all select 'comps',count(*),count(*) filter(where latitude is null or longitude is null) from comps union all select 'assets',count(*),count(*) filter(where latitude is null or longitude is null) from assets`,
  comp_quality: `select comp_type,asset_class,count(*) total,count(*) filter(where latitude is null or longitude is null) unlocated,count(*) filter(where geocode_precision='city') city_precision from comps group by comp_type,asset_class`,
  installed_columns: `select column_name from information_schema.columns where table_schema='public' and table_name='deals' and column_name like 'portfolio%'`,
};
for (const [name,query] of Object.entries(queries)) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {method:'POST',headers:{Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query,read_only:true})});
  console.log(name, response.status, await response.text());
  if (!response.ok) process.exitCode=1;
}
for (const [table,column] of [['offers','id'],['assets','id'],['app_settings','key']]) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=${column}&limit=1`,{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:`Bearer ${env.SUPABASE_ANON_KEY}`}});
  const body = await response.json();
  console.log('anonymous_read',JSON.stringify({table,status:response.status,rows:Array.isArray(body)?body.length:null}));
}
