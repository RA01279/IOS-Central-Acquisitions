import { beforeAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks=vi.hoisted(()=>({user:{email:"synthetic@example.test"} as any,property:null as any,saved:null as any,search:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/auth",()=>({getCurrentUser:async()=>mocks.user}));
vi.mock("@/lib/demand-search",()=>({searchNearby:(...args:any[])=>mocks.search(...args)}));
vi.mock("@/lib/supabase",()=>({getServiceClient:()=>({from:(table:string)=>{const b:any={select:()=>b,eq:()=>b,order:()=>b,limit:()=>b,single:async()=>({data:table==="deals"?{id:"deal",property_id:"property"}:mocks.property,error:null}),maybeSingle:async()=>({data:table==="deal_analysis_versions"?mocks.saved:{properties:mocks.property},error:null})};return b;},rpc:(...args:any[])=>mocks.rpc(...args)})}));
let GET:any,POST:any,READ:any;const props={params:Promise.resolve({id:"00000000-0000-4000-8000-000000000001"})};
beforeAll(async()=>{vi.stubEnv("GOOGLE_MAPS_SERVER_KEY","synthetic");({GET}=await import("../../app/api/deals/[id]/demand-map/route"));({POST,GET:READ}=await import("../../app/api/deals/[id]/analysis/route"));});
beforeEach(()=>{mocks.saved=null;mocks.user={email:"synthetic@example.test"};mocks.property={address:"Synthetic yard",city:"Rincon",market:"Savannah",latitude:32.2,longitude:-81.2,geocode_precision:"manual"};mocks.search.mockReset().mockResolvedValue({tenants:[],screened:0,searchSummary:{queries:22,succeeded:22,failed:0,firstPageLimited:3}});mocks.rpc.mockReset().mockResolvedValue({data:{version:1,created_at:"2026-10-28T16:00:00Z",created_by:"synthetic"},error:null});vi.stubGlobal("fetch",vi.fn(async()=>new Response(new Uint8Array([1,2,3]),{status:200})));});
afterEach(()=>vi.unstubAllGlobals());
it("uses the stored verified non-Texas pin and returns dated complete-source metadata",async()=>{
 const response=await GET(new NextRequest("http://localhost/api?radiusMiles=7"),props),body=await response.json();expect(response.status).toBe(200);
 expect(body.center).toEqual({lat:32.2,lng:-81.2});expect(body.address).not.toContain("TX");expect(body.perCategoryCap).toBe(8);expect(Number.isFinite(Date.parse(body.fetchedAt))).toBe(true);
 expect(body.searchSummary).toMatchObject({queries:22,succeeded:22,failed:0});expect(response.headers.get("cache-control")).toBe("no-store");
 expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({lat:32.2,lng:-81.2,radiusMiles:7,perCategoryCap:8}));
});
it("requires authentication, a supported radius and a located pin before querying",async()=>{
 mocks.user=null;expect((await GET(new NextRequest("http://localhost/api"),props)).status).toBe(401);mocks.user={email:"synthetic"};
 expect((await GET(new NextRequest("http://localhost/api?radiusMiles=100"),props)).status).toBe(400);
 mocks.property.geocode_precision="city";expect((await GET(new NextRequest("http://localhost/api"),props)).status).toBe(422);expect(mocks.search).not.toHaveBeenCalled();
});
it("rejects incomplete searches instead of offering a misleading reviewed count",async()=>{
 mocks.search.mockResolvedValue({tenants:[],screened:0,searchSummary:{queries:22,succeeded:21,failed:1,firstPageLimited:0}});
 const response=await GET(new NextRequest("http://localhost/api"),props);expect(response.status).toBe(502);expect((await response.json()).error).toMatch(/incomplete/);
});
it("prevents saving a review for an old property pin and preserves optimistic version checking",async()=>{
 const payload={excluded:[],data:{address:"Synthetic",center:{lat:30,lng:-95},radiusMiles:5,zoom:12,imageBase64:"data:image/png;base64,aGVsbG8=",tenants:[]}};
 const req=()=>new NextRequest("http://localhost/api",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind:"demand",expected:0,payload})});
 expect((await POST(req(),props)).status).toBe(409);expect(mocks.rpc).not.toHaveBeenCalled();
 mocks.property.latitude=30;mocks.property.longitude=-95;expect((await POST(req(),props)).status).toBe(200);
 expect(mocks.rpc).toHaveBeenCalledWith("save_deal_analysis",expect.objectContaining({p_expected:0,p_kind:"demand",p_payload:payload}));
});
it("checks the current pin on a saved-review read used immediately before export",async()=>{
 mocks.saved={version:2,created_at:"2026-10-28T16:00:00Z",created_by:"synthetic",payload:{excluded:[],data:{address:"Synthetic",center:{lat:32.2,lng:-81.2},radiusMiles:5,zoom:12,imageBase64:"data:image/png;base64,aGVsbG8=",tenants:[]}}};
 const request=()=>new NextRequest("http://localhost/api?kind=demand");
 const matching=await READ(request(),props);expect(matching.status).toBe(200);expect((await matching.json()).locationCurrent).toBe(true);
 mocks.property.latitude=33;const changed=await READ(request(),props),body=await changed.json();expect(body.saved.version).toBe(2);expect(body.locationCurrent).toBe(false);
 expect(changed.headers.get("cache-control")).toBe("no-store");expect(mocks.rpc).not.toHaveBeenCalled();
});