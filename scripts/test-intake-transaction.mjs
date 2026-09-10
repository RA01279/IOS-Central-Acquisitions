import nextEnv from '@next/env';
import {readFileSync} from 'node:fs';
nextEnv.loadEnvConfig(process.cwd());
const migration=readFileSync('supabase/migrations/20260909215353_intake_correctness.sql','utf8');
const assertions=`
do $$
declare k uuid:=gen_random_uuid(); label text:='Audit fixture '||gen_random_uuid(); r jsonb; r2 jsonb; d uuid; n int; v jsonb;
begin
 r:=public.create_deal_atomic(k,jsonb_build_object('address',label,'city','Houston','asset_type','ios'),'{"asset_class":"ios","mla_status":"requested"}',null,'[]','regression-test');
 d:=(r->'deal'->>'id')::uuid;
 if d is null then raise exception 'No deal created'; end if;
 r2:=public.create_deal_atomic(k,jsonb_build_object('address',label,'city','Houston','asset_type','ios'),'{"asset_class":"ios","mla_status":"requested"}',null,'[]','regression-test');
 if r2->'deal'->>'id'<>d::text or not (r2->>'replayed')::boolean then raise exception 'Retry created another deal'; end if;
 r2:=public.create_deal_atomic(gen_random_uuid(),jsonb_build_object('address',label,'city','Houston','asset_type','ios'),'{"asset_class":"ios","mla_status":"requested"}',null,'[]','regression-test');
 if jsonb_array_length(r2->'duplicates')<>1 or r2 ? 'deal' then raise exception 'Duplicate address not blocked'; end if;
 select count(*) into n from public.properties;
 begin
   perform public.create_deal_atomic(gen_random_uuid(),jsonb_build_object('address',label||' failed','city','Houston','asset_type','ios'),'{"asset_class":"ios","mla_status":"provided"}','{"market_base_rent":1.5}', '[{"name":"Regression contact","role":"invalid-role","type":"broker"}]','regression-test');
   raise exception 'Expected invalid contact failure';
 exception when check_violation then null; end;
 if (select count(*) from public.properties)<>n then raise exception 'Partial property survived failure'; end if;
 begin
   perform public.transition_deal(d,'prospect','closed','stage_corrected','{}','regression-test','{}');
   raise exception 'Expected forward correction failure';
 exception when raise_exception then if sqlerrm='Expected forward correction failure' then raise; end if; end;
 perform public.transition_deal(d,'prospect','uw','advanced_to_uw','{}','regression-test','{}');
 perform public.transition_deal(d,'uw','offered','marked_offered','{}','regression-test','{}');
 perform public.transition_deal(d,'offered','moving_to_psa','confirmed_psa','{}','regression-test','{}');
 perform public.transition_deal(d,'moving_to_psa','due_diligence','entered_due_diligence','{}','regression-test','{}');
 begin
   perform public.transition_deal(d,'due_diligence','closed','marked_closed','{}','regression-test','{}');
   raise exception 'Expected incomplete closing failure';
 exception when check_violation then null; end;
 perform public.transition_deal(d,'due_diligence','closed','marked_closed','{}','regression-test',jsonb_build_object('closed_price',4200000,'closed_on',current_date));
 if not exists(select 1 from public.deals dd join public.assets a on a.id=dd.portfolio_asset_id where dd.id=d and a.status='owned') then raise exception 'Closed asset missing'; end if;
 perform public.transition_deal(d,'closed','due_diligence','stage_corrected','{}','regression-test','{"closed_price":null,"closed_on":null}');
 v:=public.save_deal_analysis(d,'comps',0,'{"excluded":[]}','regression-test');
 if v->>'version'<>'1' then raise exception 'Analysis not saved'; end if;
 begin
   perform public.save_deal_analysis(d,'comps',0,'{}','regression-test');
   raise exception 'Expected stale review failure';
 exception when raise_exception then if sqlerrm='Expected stale review failure' then raise; end if; end;
end $$;
select 'PASS: atomic intake, retry, duplicates, rollback, transitions, assets and review conflict; rolled back' as result;
rollback;`;
const ref=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const query=process.argv.includes('--verify') ? `select (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('create_deal_atomic','transition_deal','save_deal_analysis')) as installed_functions,(select count(*) from pg_constraint where conname='deals_closed_complete') as closing_check,to_regclass('public.deal_analysis_versions') as reviews_table,(select count(*) from deals where stage not in ('archived','closed') and deal_type='acquisition') as active_deals;` : migration.replace(/commit;\s*$/i,()=>assertions);
const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query})});
console.log(response.status,await response.text());
if(!response.ok) process.exitCode=1;
