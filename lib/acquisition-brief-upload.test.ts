import { beforeEach, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { acquisitionBrief } from "./acquisition-brief";
const state=vi.hoisted(()=>({tables:{} as Record<string,any[]>,files:new Map<string,Uint8Array>(),auth:true}));
vi.mock("./auth",()=>({getCurrentUser:async()=>state.auth?{email:"fixture@test"}:null}));
vi.mock("./deals",()=>({logDealEvent:async()=>{}}));
vi.mock("./webhooks",()=>({fireStageChangeWebhook:async()=>{}}));
vi.mock("./stage-tasks-db",()=>({createStageTasks:async()=>{}}));
vi.mock("./ic-deck/auto",()=>({execSummaryAfterUpload:async()=>{}}));
vi.mock("next/server",async original=>({...await original<any>(),after:()=>{}}));
vi.mock("./supabase",()=>({getServiceClient:()=>({from:(table:string)=>new Query(table),storage:{from:()=>({createSignedUploadUrl:async(path:string)=>({data:{path,token:"fixture-token"},error:null}),download:async(path:string)=>({data:new Blob([state.files.get(path)! as any]),error:null})})}})}));
class Query {
 filters:((r:any)=>boolean)[]=[];inserted:any=null;updateValue:any=null;descending=false;max=Infinity;
 constructor(public table:string){}
 select(){return this;}eq(key:string,value:any){this.filters.push(r=>r[key]===value);return this;}order(_:string,opts?:any){this.descending=opts?.ascending===false;return this;}limit(n:number){this.max=n;return this;}
 insert(value:any){this.inserted=value;return this;}update(value:any){this.updateValue=value;return this;}delete(){return this;}
 rows(){const rows=(state.tables[this.table]??[]).filter(r=>this.filters.every(f=>f(r)));if(this.updateValue)rows.forEach(r=>Object.assign(r,this.updateValue));return this.descending?[...rows].sort((a,b)=>b.version_number-a.version_number).slice(0,this.max):rows.slice(0,this.max);}
 async single(){if(this.inserted){const rows=state.tables[this.table]??(state.tables[this.table]=[]),data={id:`${this.table}-${rows.length+1}`,created_at:new Date().toISOString(),...this.inserted};rows.push(data);return {data,error:null};}return {data:this.rows()[0]??null,error:null};}
 async maybeSingle(){return {data:this.rows()[0]??null,error:null};}then(resolve:any,reject:any){return Promise.resolve({data:this.rows(),error:null}).then(resolve,reject);}
}
import {POST as slot} from "../app/api/deals/[id]/upload-url/route";
import {POST as save} from "../app/api/deals/[id]/versions/route";
const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002";
beforeEach(()=>{state.auth=true;state.files.clear();state.tables={deals:[{id:a,deal_type:"acquisition",stage:"uw",properties:{address:"100 Test Road"}},{id:b,deal_type:"acquisition",stage:"uw",properties:{address:"200 Other Road"}}],documents:[],uw_versions:[]};});
const req=(body:any)=>new Request("https://fixture.test/api",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}) as any;
const loaded=(id:string)=>({...state.tables.deals.find(d=>d.id===id),uw_versions:state.tables.uw_versions.filter(v=>v.deal_id===id),documents:state.tables.documents.filter(d=>d.deal_id===id)});
async function upload(id:string,price:number){
 const wb=new ExcelJS.Workbook(),s=wb.addWorksheet("_Upload_");
 ["Purchase Price","Total Sources","In-Place Cap on PP","Stab cap-on-all-in (Yield to Cost)","Exit Cap with adj","Last sale","Gross IRR Lev","Gross Equity Mult.","Lev Avg CoC"].forEach((label,i)=>{s.getCell(`B${i+1}`).value=label;s.getCell(`C${i+1}`).value=[price,price+100000,0,.08,.06,48,-.05,.9,0][i];});
 const params={params:Promise.resolve({id})};const issued=await slot(req({fileName:"Fixture.xlsm"}),params);expect(issued.status).toBe(200);const {path}=await issued.json();state.files.set(path,new Uint8Array(await wb.xlsx.writeBuffer()));
 const saved=await save(req({storagePath:path,fileName:"Fixture.xlsm"}),params);expect(saved.status).toBe(201);return (await saved.json()).version;
}
it("enables a brief after upload, defaults to replacement uploads, retains older versions and isolates two deals",async()=>{
 expect(()=>acquisitionBrief(loaded(a))).toThrow(/Upload/);
 const first=await upload(a,3000000);expect(acquisitionBrief(loaded(a)).metrics[0].value).toBe("$3,000,000");
 const second=await upload(a,3100000);expect(acquisitionBrief(loaded(a)).versionId).toBe(second.id);expect(acquisitionBrief(loaded(a),first.id).metrics[0].value).toBe("$3,000,000");
 await upload(b,5000000);expect(acquisitionBrief(loaded(b)).metrics[0].value).toBe("$5,000,000");expect(()=>acquisitionBrief(loaded(b),first.id)).toThrow(/does not belong/);
 expect(state.tables.uw_versions).toHaveLength(3);
});
