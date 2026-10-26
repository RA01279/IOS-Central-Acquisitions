import {beforeEach,describe,expect,it,vi} from 'vitest';
import {rendon} from '../../ios-uw/fixtures/rendon';

const state=vi.hoisted(()=>({missing:false,failed:false,inserted:null as any,query:''}));
vi.mock('@/lib/auth',()=>({getCurrentUser:async()=>({email:'audit@example.com'})}));
vi.mock('@/lib/deals',()=>({logDealEvent:async()=>{}}));
vi.mock('@/lib/uw-screen',()=>({listRuns:async()=>[],latestModel:()=>null,screenFor:async()=>({comps:{asOf:'2026-10-26'},evidenceRows:[]})}));
vi.mock('@/lib/supabase',()=>({
 getServiceClient:()=>({
  from:(table:string)=>{
   if(table==='deals') return {
    select:(query:string)=>{
     state.query=query;
     return {eq:()=>({maybeSingle:async()=>{
      // Actual production schema has city/market, but no properties.state.
      const unsupported=/properties\([^)]*\bstate\b/.test(query);
      return {
       data:state.missing||state.failed||unsupported?null:{id:'5f6b3c34-7751-4483-a08a-d6fd57496842',asset_class:'ios'},
       error:state.failed||unsupported?{message:'column does not exist'}:null
      };
     }})};
    }
   };
   return {insert:(row:any)=>{
    state.inserted=row;
    return {select:()=>({single:async()=>({data:{id:'saved',...row},error:null})})};
   }};
  }
 })
}));
import {POST} from '../../../app/api/deals/[id]/uw-runs/route';

const id='5f6b3c34-7751-4483-a08a-d6fd57496842';
const request=()=>new Request('https://hopper.test/api/deals/'+id+'/uw-runs',{method:'POST',body:JSON.stringify({inputs:{...rendon,RollMethod:1,NnnRecovered:false,capex:[]},label:'Audit screening'})}) as any;
describe('saved underwriting production schema regression',()=>{
 beforeEach(()=>{state.missing=false;state.failed=false;state.inserted=null;});
 it('saves an existing deal using supported property columns and retains evidence',async()=>{
  const res=await POST(request(),{params:Promise.resolve({id})});
  expect(res.status).toBe(200);expect(state.inserted.deal_id).toBe(id);
  expect(state.inserted.comp_snapshot).toEqual({asOf:'2026-10-26',evidenceRows:[]});
  expect(state.inserted.results.returns.year1Noi).toBeCloseTo(427815,6);
 });
 it('reports a query failure as a save failure rather than a nonexistent deal',async()=>{
  state.failed=true;const res=await POST(request(),{params:Promise.resolve({id})});expect(res.status).toBe(500);expect(state.inserted).toBeNull();
 });
 it('reserves not found for an actually absent deal',async()=>{
  state.missing=true;const res=await POST(request(),{params:Promise.resolve({id})});expect(res.status).toBe(404);expect(state.inserted).toBeNull();
 });
});
