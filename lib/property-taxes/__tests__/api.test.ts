import {beforeAll,afterAll,beforeEach,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
import {taxTestDb,taxTestClient,taxDealId} from "../../../tests/helpers/tax-test-db";
import {taxFixture} from "./fixtures";
import {readFileSync} from 'node:fs';
import {billAccountMatches} from '../bill-account';
// PGlite (in-memory Postgres) can take longer than the default 10 s to start.
const mocks=vi.hoisted(()=>({user:{email:"local-test@example.test"} as {email:string}|null,db:null as any,revalidate:vi.fn(),research:vi.fn()}));
vi.mock("@/lib/auth",()=>({getCurrentUser:async()=>mocks.user}));
vi.mock("@/lib/supabase",()=>({getServiceClient:()=>mocks.db}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}));
vi.mock("@/lib/property-taxes/research",()=>({researchTaxes:(...args:any[])=>mocks.research(...args)}));
import {GET,POST} from "../../../app/api/deals/[id]/property-taxes/route";
let pg:Awaited<ReturnType<typeof taxTestDb>>;const props={params:Promise.resolve({id:taxDealId})};
const request=(body:unknown,origin="http://localhost")=>new NextRequest(`http://localhost/api/deals/${taxDealId}/property-taxes`,{method:"POST",headers:{"Content-Type":"application/json",origin},body:JSON.stringify(body)});
beforeAll(async()=>{pg=await taxTestDb();mocks.db=taxTestClient(pg);},60000);afterAll(async()=>{await pg?.close();});beforeEach(()=>{mocks.user={email:"local-test@example.test"};mocks.revalidate.mockClear();});
it("authenticates all reads and mutations and checks origin, IDs and missing deals",async()=>{
  mocks.user=null;expect((await GET(new NextRequest("http://localhost"),props)).status).toBe(401);expect((await POST(request({action:"save"}),props)).status).toBe(401);
  mocks.user={email:"test"};expect((await POST(request({action:"save"},"https://evil.example"),props)).status).toBe(403);
  expect((await GET(new NextRequest("http://localhost"),{params:Promise.resolve({id:"bad"})})).status).toBe(400);
  expect((await GET(new NextRequest("http://localhost"),{params:Promise.resolve({id:"00000000-0000-4000-8000-000000000099"})})).status).toBe(404);
});
it("saves reviews and preserves immutable evidence and history without applying underwriting",async()=>{
  const response=await POST(request({action:"save",revision:0,state:taxFixture()}),props);expect(response.status).toBe(200);expect((await response.json()).revision).toBe(1);
  expect(mocks.revalidate).toHaveBeenCalledWith(`/deals/${taxDealId}/property-taxes`);
  expect((await POST(request({action:"save",revision:0,state:taxFixture()}),props)).status).toBe(409);
  const read=await GET(new NextRequest("http://localhost"),props),body=await read.json();expect(body.history).toHaveLength(1);expect(body.state.records[0].year).toBe(2026);
  const history=await GET(new NextRequest("http://localhost?revision=1"),props);expect((await history.json()).snapshot.sources[0].evidence).toContain("Synthetic");
  expect((await pg.query("select * from deals")).rows).toHaveLength(1);
});
it("streams progress and partial results, saves research once, and keeps manual overrides",async()=>{
  mocks.research.mockImplementation(async(_subject:any,_state:any,emit:any)=>{const report=taxFixture();report.research={at:new Date().toISOString(),status:"partial",gaps:["Collector inaccessible"]};emit("Checking official county source",report);return report;});
  const response=await POST(request({action:"research",revision:1}),props);expect(response.headers.get("content-type")).toContain("ndjson");const events=(await response.text()).trim().split("\n").map(line=>JSON.parse(line));
  expect(events[0]).toMatchObject({type:"progress",message:"Checking official county source"});expect(events.at(-1).type).toBe("complete");
  expect(events.at(-1).workspace.state.research.gaps).toContain("Collector inaccessible");
  const row=(await pg.query<{state:any}>("select state from deal_property_taxes")).rows[0];expect(row.state.scenarios).toHaveLength(0);
});
it("rejects cross-deal bill links and invalid uploads before storing files",async()=>{
  const state=taxFixture();state.sources[0].storagePath="deals/another/property-taxes/bill.pdf";
  expect((await POST(request({action:"save",revision:2,state}),props)).status).toBe(403);
  const form=new FormData();form.append("revision","2");form.append("bill",new File(["bad data"],"bill.pdf",{type:"application/pdf"}));
  const response=await POST(new NextRequest(`http://localhost/api/deals/${taxDealId}/property-taxes`,{method:"POST",headers:{origin:"http://localhost"},body:form}),props);expect(response.status).toBe(400);
  expect((await GET(new NextRequest("http://localhost?source=not-found"),props)).status).toBe(404);
});
it("retains a validated bill attachment and returns only a deal-scoped signed link",async()=>{
  const files=new Map<string,unknown>();mocks.db.storage={from:(bucket:string)=>{expect(bucket).toBe("documents");return {upload:async(path:string,bytes:Buffer)=>{files.set(path,bytes);return {error:null};},createSignedUrl:async(path:string)=>({data:{signedUrl:`https://storage.example.test/${path}`},error:null})};}};
  const form=new FormData();form.append("revision","2");form.append("bill",new File(["%PDF-1.7\nSynthetic bill attachment\n%%EOF"],"synthetic-bill.pdf",{type:"application/pdf"}));
  const response=await POST(new NextRequest(`http://localhost/api/deals/${taxDealId}/property-taxes`,{method:"POST",headers:{origin:"http://localhost"},body:form}),props);expect(response.status).toBe(200);const saved=await response.json(),source=saved.state.sources.at(-1);expect(source.kind).toBe("upload");expect(files.size).toBe(1);expect(source.storagePath).toContain(`deals/${taxDealId}/property-taxes/`);
  const signed=await GET(new NextRequest(`http://localhost?source=${source.id}`),props);expect(signed.status).toBe(307);expect(signed.headers.get("location")).toContain(source.storagePath);
});
it('imports verified account text with preserved provenance and rejects mismatched history before saving',async()=>{
 const workspace=await (await GET(new NextRequest('http://localhost'),props)).json();
 const state=workspace.state;Object.assign(state.parcels[0],{accountId:'R6250 010',county:'Gwinnett',state:'GA',address:'3000 Amwiler Road'});
 const saveResponse=await POST(request({action:'save',revision:workspace.revision,state}),props),saved=await saveResponse.json();expect(saveResponse.status,JSON.stringify(saved)).toBe(200);
 const text=readFileSync(new URL('./gwinnett-history-capture.txt',import.meta.url),'utf8');
 const body={action:'import-history',revision:saved.revision,parcelKey:state.parcels[0].key,text,sourceUrl:'https://www.gwinnetttaxcommissioner.com/property-tax/view-pay-your-taxes/-/p/propertyInfo/R6250+010/1085543'};
 const bad=await POST(request({...body,text:text.replace('3000 AMWILER','3002 AMWILER')}),props);expect(bad.status).toBe(400);
 const response=await POST(request(body),props);const result=await response.json();expect(response.status,JSON.stringify(result)).toBe(200);
 expect(result.state.records.find((r:any)=>r.year===2025).facts.levied.value).toBe(7079.41);expect(result.state.sources.at(-1).captureMethod).toBe('user_import');
 expect(result.state.scenarios).toHaveLength(0);
 expect((await POST(request(body),props)).status).toBe(409);
});
it('retains original county bytes during research and reloads the saved source link',async()=>{
 const files=new Map<string,Uint8Array>();
 mocks.db.storage={from:()=>({upload:async(path:string,bytes:Uint8Array)=>{files.set(path,bytes.slice());return {error:null};},createSignedUrl:async(path:string)=>({data:{signedUrl:`https://storage.example.test/${path}`},error:null})})};
 const bytes=new TextEncoder().encode('%PDF-1.7\nindependent retained original');
 mocks.research.mockImplementation(async(_subject:any,_state:any,_emit:any,_fetch:any,retain:any)=>{
  const report=taxFixture();report.sources[0].id='retained-county-original';report.sources[0].kind='official';
  for(const f of Object.values(report.records[0].facts) as any[])f.sourceId=report.sources[0].id;
  report.parcels[0].sourceIds=[report.sources[0].id];
  report.scopeReview!.sourceIds=[report.sources[0].id];report.records[0].billEvidence!.sourceId=report.sources[0].id;
  await retain(report.sources[0],bytes,'application/pdf');return report;
 });
 const current=await(await GET(new NextRequest('http://localhost'),props)).json();
 const response=await POST(request({action:'research',revision:current.revision}),props);
 const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
 expect(events.at(-1).type).toBe('complete');
 const loaded=await(await GET(new NextRequest('http://localhost'),props)).json();
 const source=loaded.state.sources.find((s:any)=>s.id==='retained-county-original');
 expect(source.storagePath).toMatch(/retained-county-original-[a-f0-9]{64}\.pdf$/);
 expect(files.get(source.storagePath)).toEqual(bytes);
 const signed=await GET(new NextRequest(`http://localhost?source=${source.id}`),props);expect(signed.status).toBe(307);
});
it('saves and reloads an assisted Bexar bill using the printed collector alias and rejects the assessor ID as a collector alias',async()=>{
 const current=await(await GET(new NextRequest('http://localhost'),props)).json();
 const state=current.state,p=state.parcels[0];
 Object.assign(p,{county:'Bexar',state:'TX',accountId:'542790',assessmentGroup:'14101-005-0060',address:'4711 Broom St',review:'pending'});
 const original=state.sources.find((s:any)=>s.storagePath)!;expect(original).toBeDefined();
 const save=await POST(request({action:'save',revision:current.revision,state}),props),saved=await save.json();expect(save.status).toBe(200);
 const manifest=[{year:2026,account:'542790',bills:[{id:'synthetic-bexar-issued',originalSourceId:original.id,url:'https://bexar.acttax.com/act_webdev/bexar/index.jsp',retrievedAt:'2026-10-26T12:00:00Z',collector:'Bexar County',collectorAccount:'14101-005-0060',version:'issued',total:34582.07,authorities:[{name:'Synthetic test combined authority rows',levied:34582.07}]}]}];
 const body={action:'import-assisted',revision:saved.revision,parcelKey:p.key,text:JSON.stringify(manifest)};
 expect((await POST(request({...body,text:body.text.replace('14101-005-0060','542790')}),props)).status).toBe(400);
 const imported=await POST(request(body),props);expect(imported.status).toBe(200);
 const loaded=await(await GET(new NextRequest('http://localhost'),props)).json(),row=loaded.state.records.find((r:any)=>r.parcelKey===p.key&&r.year===2026);
 expect(row.billEvidence.collectorAccount).toBe('14101-005-0060');expect(billAccountMatches(p,row)).toBe(true);
 expect(row.facts.levied.value).toBe(34582.07);expect(row.facts.levied.reviewed).toBe(false);expect(row.billEvidence.obligationStatus).toBe('unverified');
});
