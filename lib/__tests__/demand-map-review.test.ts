import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { reviewedMap, snapshotFromReview, observationLabel, reviewMatchesPin } from "../demand-map-review";
import { demandBreakdown, demandIndex, resolveFlags, siteScore } from "../site-score";
import { summaryReviewedMap, MAP_H, MAP_W } from "../ic-deck/summary-slide";
import { computePixelPositions } from "../ic-deck/iosDemandMap";
import { searchNearby } from "../demand-search";
const image="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
const payload=()=>({data:{address:"Synthetic subject",center:{lat:30,lng:-95},radiusMiles:7,zoom:11,fetchedAt:"2026-10-28T15:00:00.000Z",imageBase64:image,tenants:[{name:"Keep",placeId:"keep",category:"Trucking & Towing",lat:30.01,lng:-95,distanceMi:999},{name:"Excluded",placeId:"excluded",category:"Contractor Yard",lat:30.02,lng:-95,distanceMi:0},{name:"Outside",placeId:"outside",category:"Pipe & Steel",lat:31,lng:-95,distanceMi:0}]},excluded:["excluded"]});
const review=()=>({payload:payload(),version:4,created_at:"2026-10-28T16:00:00Z",created_by:"synthetic@example.test"});
describe("one reviewed business map",()=>{
 it("uses exclusions and recomputed geography identically for counts and summary projection",()=>{
   const r=review(),map=reviewedMap(r.payload)!; expect(map.tenants.map(t=>t.name)).toEqual(["Keep"]);
   expect(map.tenants[0].distanceMi).toBeGreaterThan(.6); expect(r.payload.data.tenants).toHaveLength(3);
   const snap=snapshotFromReview(r)!;expect(demandBreakdown(snap,7)).toMatchObject({total:1,index:null});
   const summary=summaryReviewedMap(map),pixels=computePixelPositions(map);expect(summary.pins).toHaveLength(1);
   expect(summary.mapImages?.imagery).toBe(image);expect(summary.mapImages?.width).toBe(MAP_H);
   expect(summary.pins[0].x).toBeCloseTo((MAP_W-MAP_H)/2+pixels.tenants[0].px.x/pixels.size*MAP_H,8);
   expect(summary.pins[0].y).toBeCloseTo(pixels.tenants[0].px.y/pixels.size*MAP_H,8);
   expect(summary.rings.at(-1)?.miles).toBe(7);
 });
 it("never makes a legacy observation look newly fetched or falls back to scored data",()=>{
   const r=review(); delete (r.payload.data as any).fetchedAt;
   expect(observationLabel(r.payload.data)).toBe("Unavailable (legacy review)");
   expect(snapshotFromReview(null)).toBeNull();expect(reviewedMap({data:r.payload.data,excluded:"bad"})).toBeNull();
   expect(observationLabel(payload().data)).toBe("2026-10-28 15:00:00 UTC");
   expect(summaryReviewedMap(null).mapImages).toBeNull();
 });
 it("invalidates the source if the property pin changes",()=>{
   expect(reviewMatchesPin(review(),30,-95)).toBe(true);expect(reviewMatchesPin(review(),30.1,-95)).toBe(false);
   expect(reviewMatchesPin(review(),null,null)).toBe(false);
 });
 it("does not turn old Places counts into a demand grade or site-score contribution",()=>{
   expect(demandIndex(100,3)).toBeNull();
   const rows:any[]=[{key:"demand",auto_state:"strong",auto_note:"89 hits (index 99)"},{key:"zoning",auto_state:"strong"},{key:"access",auto_state:"strong"}];
   const flags=resolveFlags(rows);expect(flags[0].state).toBe("unknown");expect(flags[0].note).not.toContain("89");
   expect(siteScore(flags).score).toBeNull();
   expect(demandBreakdown(snapshotFromReview(review()),7).rows.every(r=>r.state==="unknown")).toBe(true);
 });
});
afterEach(()=>vi.unstubAllGlobals());
it("records query failures and first-page limits so the map route can reject incomplete searches",async()=>{
 vi.stubGlobal("fetch",vi.fn(async(input:any)=>{const kw=new URL(String(input)).searchParams.get("keyword");return {json:async()=>kw==="bad"?{status:"REQUEST_DENIED"}:{status:"OK",next_page_token:"more",results:[]}}}));
 const result=await searchNearby({lat:30,lng:-95,radiusMiles:5,categories:[{label:"Trucking & Towing",keywords:["good","bad"]}],perCategoryCap:8,apiKey:"synthetic"});
 expect(result.searchSummary).toEqual({queries:2,succeeded:1,failed:1,firstPageLimited:1});
});