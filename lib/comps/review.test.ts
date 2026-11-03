import {it,expect} from "vitest";
import {compReview} from "./reviewed-evidence";
import {compUnderwriting} from "./underwriting";
import {scoreComps,suggestRange} from "./match";
const subject={lat:32.62,lng:-97.19,lotSf:8.7*43560,buildingSf:16000,coveragePct:16000/(8.7*43560),market:"Fort Worth",submarket:null,assetClass:"ios"};
const rows=Array.from({length:5},(_,i)=>({id:String(i),comp_type:"lease" as const,address:"Yard "+i,asset_class:"ios",market:"Fort Worth",latitude:32.62,longitude:-97.19,geocode_precision:"rooftop",date_commenced:"2026-09-01",lot_sf:16.59*43560,building_sf:7226.6,rent:5500+i*100,rent_basis:"per_acre_monthly"}));
it("keeps acreage quotes out of direct building guidance and labels diagnostic conversions",()=>{
 const uw=compUnderwriting(rows,subject,{today:new Date("2026-10-29")});expect(uw.lease.perSfAnnual.mid).toBeNull();expect(uw.lease.perSfAnnual.count).toBe(0);expect(uw.lease.perAcreMonthly.count).toBe(5);
 const r=suggestRange(scoreComps(rows,subject,"lease",{basis:"building",today:new Date("2026-10-29")}),"lease","building");expect(r.caveats.join(" ")).toMatch(/not direct building/);
});
it("uses the frozen reviewed evidence and exclusions for every server consumer and invalidates changed subjects",()=>{
 const d={deal_analysis_versions:[{kind:"comps",version:2,created_at:"2026-10-29",payload:{subject,excluded:["4"],comps:rows}}]};
 const r=compReview(d,[...rows,{...rows[0],id:"new"}],subject);expect(r.comps.map((x:any)=>x.id)).toEqual(["0","1","2","3"]);
 expect(compUnderwriting(r.comps,r.subject,{today:new Date("2026-10-29")}).lease.perAcreMonthly.count).toBe(4);
 const reordered={...d,deal_analysis_versions:[{...d.deal_analysis_versions[0],payload:{...d.deal_analysis_versions[0].payload,subject:Object.fromEntries(Object.entries(subject).reverse())}}]};
 expect(compReview(reordered,rows,subject).stale).toBe(false);
 expect(compReview(d,rows,{...subject,lotSf:999}).stale).toBe(true);expect(compReview(d,rows,{...subject,lotSf:999}).comps).toEqual([]);
});
