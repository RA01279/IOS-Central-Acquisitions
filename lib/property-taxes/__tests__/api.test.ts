import {beforeAll,afterAll,beforeEach,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
import {taxTestDb,taxTestClient,taxDealId} from "../../../tests/helpers/tax-test-db";
import {taxFixture} from "./fixtures";
const mocks=vi.hoisted(()=>({user:{email:"local-test@example.test"} as {email:string}|null,db:null as any,revalidate:vi.fn(),research:vi.fn()}));
vi.mock("@/lib/auth",()=>({getCurrentUser:async()=>mocks.user}));
vi.mock("@/lib/supabase",()=>({getServiceClient:()=>mocks.db}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}));
vi.mock("@/lib/property-taxes/research",()=>({researchTaxes:(...args:any[])=>mocks.research(...args)}));
import {GET,POST} from "../../../app/api/deals/[id]/property-taxes/route";
let pg:Awaited<ReturnType<typeof taxTestDb>>;const props={params:Promise.resolve({id:taxDealId})};
const request=(body:unknown,origin="http://localhost")=>new NextRequest(`http://localhost/api/deals/${taxDealId}/property-taxes`,{method:"POST",headers:{"Content-Type":"application/json",origin},body:JSON.stringify(body)});
beforeAll(async()=>{pg=await taxTestDb();mocks.db=taxTestClient(pg);});afterAll(async()=>{await pg?.close();});beforeEach(()=>{mocks.user={email:"local-test@example.test"};mocks.revalidate.mockClear();});
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
