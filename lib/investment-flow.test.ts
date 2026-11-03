import {beforeEach,it,expect,vi} from "vitest";
import ExcelJS from "exceljs";
import {PGlite} from "@electric-sql/pglite";
import {readFileSync} from "node:fs";
const state=vi.hoisted(()=>({tables:{} as Record<string,any[]>,events:[] as any[],authenticated:true}));
vi.mock("./auth",()=>({getCurrentUser:async()=>state.authenticated?{email:"analyst@test.local"}:null}));
vi.mock("./deals",()=>({logDealEvent:async(...args:any[])=>{state.events.push(args);},ASSET_CLASS_LABELS:{ios:"IOS",industrial:"Industrial"},STAGE_LABELS:{uw:"UW",offered:"Offered",prospect:"Prospect"}}));
vi.mock("./team",()=>({listTeam:async()=>[],nameOf:(_:any,email:string)=>email}));
vi.mock("./summary",async original=>({...await original<any>(),ctToday:()=>"2026-10-13"}));
vi.mock("./supabase",()=>({getServiceClient:()=>({from:(table:string)=>new Query(table)})}));
class Query {
 filters:((r:any)=>boolean)[]=[];patch:any=null;constructor(public table:string){}
 select(){return this;}eq(k:string,v:any){this.filters.push(r=>typeof r[k]==="object"&&r[k]!==null?JSON.stringify(r[k])===(typeof v==="string"?v:JSON.stringify(v)):r[k]===v);return this;}
 is(k:string,v:any){this.filters.push(r=>r[k]==v);return this;}in(k:string,v:any[]){this.filters.push(r=>v.includes(r[k]));return this;}
 gte(k:string,v:any){this.filters.push(r=>r[k]!=null&&r[k]>=v);return this;}lte(k:string,v:any){this.filters.push(r=>r[k]!=null&&r[k]<=v);return this;}
 or(){return this;}order(){return this;}update(p:any){this.patch=p;return this;}
 rows(){const rows=(state.tables[this.table]??[]).filter(r=>this.filters.every(f=>f(r)));if(this.patch)rows.forEach(r=>Object.assign(r,structuredClone(this.patch)));return structuredClone(rows);}
 async maybeSingle(){return {data:this.rows()[0]??null,error:null};}async range(f:number,t:number){return {data:this.rows().slice(f,t+1),error:null};}
 then(resolve:any,reject:any){return Promise.resolve({data:this.rows(),error:null}).then(resolve,reject);}
}
import {POST} from "../app/api/deals/[id]/investment-review/route";
import {GET} from "../app/api/reports/weekly/route";
import {buildWeeklyReport} from "./weekly-report";
const id="a182baf3-1ae4-4279-bcac-0ea275570f82";
const request=(body:any)=>new Request("http://localhost/api/review",{method:"POST",body:JSON.stringify(body)}) as any;
beforeEach(()=>{state.events=[];state.authenticated=true;state.tables={deals:[{id,deal_type:"acquisition",stage:"uw",asset_class:"industrial",assigned_analyst:"analyst@test.local",investment_review:null,properties:{address:"4732 Darien St",occupancy_status:"occupied"},uw_versions:[],offers:[],uw_runs:[]}],offers:[],deal_events:[],deal_milestones:[]};});
it("persists a reviewed source update on the existing record, displays the deadline and exports the same decision context",async()=>{
 const response=await POST(request({expectedReviewAt:null,review:{incomeStatus:"unknown",deadlineSource:"Call for offers October 14, 2026",deadlineSourceDate:"2026-10-06",nextAction:"Confirm financing before bid"},callForOffersOn:"2026-10-14"}),{params:Promise.resolve({id})});expect(response.status).toBe(200);
 expect(state.tables.deals).toHaveLength(1);expect(state.events[0][1]).toBe("investment_reviewed");
 const report=await buildWeeklyReport();expect(report.upcoming).toContainEqual(expect.objectContaining({id,date:"2026-10-14",what:"Call for offers"}));expect(report.decisions[0].deadlineSourceDate).toBe("2026-10-06");expect(report.decisions[0].nextAction).toBe("Confirm financing before bid");
 const exportResponse=await GET(new Request("http://localhost/api/reports/weekly") as any);expect(exportResponse.status).toBe(200);const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()) as any);const sheet=wb.getWorksheet("Investment decisions")!;const text=JSON.stringify(sheet.getSheetValues());expect(text).toContain("Call for offers October 14, 2026");expect(text).toContain("Confirm financing before bid");expect(text).toContain("Unknown");
 const stale=await POST(request({expectedReviewAt:null,review:{incomeStatus:"unknown"}}),{params:Promise.resolve({id})});expect(stale.status).toBe(409);
});
it("requires authentication and retains model identity conflicts until a recorded resolution",async()=>{
 state.authenticated=false;expect((await POST(request({}),{params:Promise.resolve({id})})).status).toBe(401);state.authenticated=true;
 const v={id:"v1",deal_id:id,version_number:1,returns_summary:{sourceProperty:"Another property",irrPct:.22}};state.tables.uw_versions=[v];state.tables.deals[0].uw_versions=[v];
 expect((await buildWeeklyReport()).decisions[0].modelIrr).toBeNull();
 const saved=await POST(request({action:"resolve_model",versionId:"v1",expectedResolutionAt:null,outcome:"accepted",reason:"Copied header reconciled against attached original rent schedules"}),{params:Promise.resolve({id})});expect(saved.status).toBe(200);state.tables.deals[0].uw_versions=state.tables.uw_versions;
 expect((await buildWeeklyReport()).decisions[0].modelIrr).toBe(.22);expect(state.events[0][1]).toBe("model_identity_resolved");
});
it("applies the additive migration in an isolated Postgres engine without changing existing rows",async()=>{
 const db=new PGlite();try{await db.exec("create table public.deals(id int primary key, stage text);insert into public.deals values(1,'uw');");await db.exec(readFileSync(new URL("../supabase/migrations/20261029221056_investment_decision_controls.sql",import.meta.url),"utf8"));expect((await db.query("select * from deals")).rows).toEqual([{id:1,stage:"uw",investment_review:null}]);}finally{await db.close();}
},30000);
