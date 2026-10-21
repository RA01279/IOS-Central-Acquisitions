import {beforeAll,afterAll,it,expect} from "vitest";
import {taxTestDb,taxTestClient,taxDealId} from "../../../tests/helpers/tax-test-db";
import {loadTaxWorkspace,saveTaxWorkspace} from "../store";
import {taxFixture} from "./fixtures";
let pg:Awaited<ReturnType<typeof taxTestDb>>,client:ReturnType<typeof taxTestClient>;
beforeAll(async()=>{pg=await taxTestDb();client=taxTestClient(pg);});afterAll(async()=>{await pg?.close();});
it("stores structured findings and append-only snapshots atomically with stale-write protection",async()=>{
  expect((await loadTaxWorkspace(client,taxDealId)).revision).toBe(0);
  const state=taxFixture();const saved=await saveTaxWorkspace(client,taxDealId,0,state,"local-test","research");expect(saved.revision).toBe(1);
  state.overrides.push({parcelKey:state.parcels[0].key,year:2026,metric:"paid",value:500,sourceId:state.sources[0].id,reason:"Synthetic payment receipt"});
  await expect(saveTaxWorkspace(client,taxDealId,0,state,"other-test")).rejects.toMatchObject({status:409});
  expect((await loadTaxWorkspace(client,taxDealId)).state.overrides).toHaveLength(0);
  await saveTaxWorkspace(client,taxDealId,1,state,"local-test");
  const history=await pg.query<{snapshot:any}>("select snapshot from deal_property_tax_history order by revision");
  expect(history.rows).toHaveLength(2);expect(history.rows[0].snapshot.overrides).toHaveLength(0);expect(history.rows[1].snapshot.overrides[0].value).toBe(500);
  const altered=structuredClone(state);altered.sources[0].evidence="Changed original source";
  await expect(saveTaxWorkspace(client,taxDealId,2,altered,"local-test")).rejects.toThrow(/retained/);
});
it("denies browser roles access to storage and RPCs and denies audit mutation to service role",async()=>{
  const result=await pg.query<{allowed:boolean}>("select has_function_privilege('anon','public.save_deal_tax_state(uuid,integer,jsonb,text,text)','execute') or has_table_privilege('authenticated','public.deal_property_taxes','select') or has_table_privilege('service_role','public.deal_property_tax_history','update') as allowed");expect(result.rows[0].allowed).toBe(false);
  const rls=await pg.query<{enabled:boolean}>("select bool_and(relrowsecurity) as enabled from pg_class where relname in ('deal_property_taxes','deal_property_tax_history')");expect(rls.rows[0].enabled).toBe(true);
});
