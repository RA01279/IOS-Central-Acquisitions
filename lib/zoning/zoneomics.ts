import { createHash } from "node:crypto";
import { validPoint, distanceMiles } from "./geometry";
import { TENANT_EVIDENCE } from "./evidence";
import type { Point, Zoning, ZoningCandidate, ZoningReport } from "./types";

type Lookup = { zoning: Zoning; cityId: string; cityName: string; checkedAt: string; updated: string };
const cache=new Map<string,{until:number;value:Promise<Lookup>}>();
const TTL=5*60*1000;
export class ZoningLookupError extends Error {}
const text=(v:unknown)=>typeof v==="string"?v.trim():"";
export function parseZoneomics(raw:any):Lookup {
  if(raw?.status!==true || !raw.data || Array.isArray(raw.data)) throw new ZoningLookupError("Zoneomics did not return a single covered zoning location.");
  const d=raw.data, meta=d.meta??d, zone=d.zone_details??d.zoneDetails??d;
  const district=text(zone.zone_code), cityName=text(meta.city_name);
  const cityId=typeof meta.city_id==="number" || typeof meta.city_id==="string" ? String(meta.city_id).trim() : "";
  if(!district || !cityId || !cityName) throw new ZoningLookupError("Zoneomics returned an incomplete zoning or municipality record.");
  // Do not return the response's top-level link: it may echo the secret API URL.
  let sourceUrl="https://www.zoneomics.com/";
  try {
    const u=new URL(text(zone.link));
    if(u.protocol==="https:" && !u.username && !u.password && !u.hostname.startsWith("api.") &&
      !/api[_-]?key|token|secret|authorization/i.test(u.href)) sourceUrl=u.toString();
  } catch { /* The provider home page remains the safe source link. */ }
  return {
    cityId,cityName,checkedAt:new Date().toISOString(),updated:text(meta.last_updated),
    zoning:{district,description:text(zone.zone_name),specialUse:"",plannedDevelopment:"",subarea:"",overlays:[],
      caseNumber:"",ordinance:"",sourceUrl,boundaryUrl:"",overlayUrl:"",status:"mapped",
      provider:"Zoneomics",municipalityId:cityId,modifiersVerified:false},
  };
}
export async function lookupZoneomics(point:Point):Promise<Lookup> {
  if(!validPoint(point)) throw new ZoningLookupError("Verify the property's exact map pin first.");
  const key=process.env.ZONEOMICS_API_KEY?.trim();
  if(!key) throw new ZoningLookupError("An administrator needs to connect the shared Zoneomics API account before this lookup can run.");
  const cacheKey=createHash("sha256").update(key).digest("hex")+":"+point.lat+":"+point.lng;
  const hit=cache.get(cacheKey);
  if(hit && hit.until>Date.now()) return hit.value;
  const value=(async()=>{
    const url=new URL("https://api.zoneomics.com/v2/zoneDetail");
    url.search=new URLSearchParams({api_key:key,lat:String(point.lat),lng:String(point.lng),output_fields:"default"}).toString();
    let response;
    try { response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(8000)}); }
    catch { throw new ZoningLookupError("Zoneomics did not respond within 8 seconds. Please retry."); }
    if(response.status===401 || response.status===403) throw new ZoningLookupError("The shared Zoneomics account needs API access. Ask an administrator to check the connection.");
    if(response.status===429) throw new ZoningLookupError("The shared Zoneomics account has reached its request limit. Please retry later.");
    if(!response.ok) throw new ZoningLookupError("Zoneomics is temporarily unavailable.");
    let raw;
    try { raw=await response.json(); } catch { throw new ZoningLookupError("Zoneomics returned an unreadable response."); }
    return parseZoneomics(raw);
  })();
  if(cache.size>=256) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey,{until:Date.now()+TTL,value});
  try{return await value;}catch(e){cache.delete(cacheKey);throw e;}
}
export function compareProviderZoning(subject:Lookup,candidate:Lookup):ZoningCandidate["match"] {
  if(subject.cityId!==candidate.cityId) return "outside";
  return subject.zoning.district===candidate.zoning.district ? "same_code" : "different";
}
type Input={dealId:string;address:string;point:Point;precision:string;radiusMiles:number};
export async function researchZoneomics(input:Input,includeNeighbors:boolean):Promise<ZoningReport> {
  if(!["rooftop","manual","geometric_center"].includes(input.precision)) throw new ZoningLookupError("Verify the property's exact map pin before researching zoning.");
  const subject=await lookupZoneomics(input.point);
  const report:ZoningReport={schemaVersion:1,generatedAt:subject.checkedAt,dealId:input.dealId,address:input.address,point:input.point,
    municipality:subject.cityName,radiusMiles:input.radiusMiles,subject:subject.zoning,candidates:[],searchCount:0,
    providerUpdated:subject.updated,warnings:[
      "Same zoning code means the provider returned the same code and municipality ID. Special-use permits, planned developments and overlays have not been independently verified.",
      "Zoning describes the location pin, not the full parcel. Site use and tenant lease status need separate evidence.",
      "Business categories are discovery clues. Unverified candidates are not confirmed IOS properties.",
    ]};
  if(!includeNeighbors) return report;
  const googleKey=process.env.GOOGLE_MAPS_SERVER_KEY;
  if(!googleKey) throw new ZoningLookupError("Nearby business search is not configured.");
  const categories=[
    ["Equipment rental","equipment rental"],["Landscape supply","landscape supply yard"],
    ["Building materials","building materials supplier"],["Contractor operations","paving contractor"],
    ["Truck / trailer operations","truck parking"],["Container operations","shipping container storage"],
  ];
  const searches=await Promise.allSettled(categories.map(async([category,keyword])=>{
    const u=new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
    u.search=new URLSearchParams({location:input.point.lat+","+input.point.lng,radius:String(input.radiusMiles*1609.344),keyword,key:googleKey}).toString();
    const response=await fetch(u,{cache:"no-store",signal:AbortSignal.timeout(8000)});
    if(!response.ok) throw new Error("Search unavailable");
    const data=await response.json();
    if(!["OK","ZERO_RESULTS"].includes(data.status)) throw new Error("Search unavailable");
    return (data.results??[]).map((p:any)=>({p,category}));
  }));
  const candidates=new Map<string,ZoningCandidate>();
  for(const result of searches) {
    if(result.status!=="fulfilled") continue;
    report.searchCount++;
    for(const {p,category} of result.value) {
      const point=p.geometry?.location;
      if(!point || !validPoint(point) || typeof p.place_id!=="string" || candidates.has(p.place_id) || p.business_status!=="OPERATIONAL") continue;
      const distanceMi=distanceMiles(input.point,point);
      if(distanceMi>input.radiusMiles || distanceMi<0.03 || /self.?storage|public storage|u-haul|home depot|lowe's|movers|moving company/i.test(p.name??"")) continue;
      candidates.set(p.place_id,{placeId:p.place_id,name:String(p.name),address:String(p.vicinity??""),point,distanceMi,category,
        mapsUrl:"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(p.name)+"&query_place_id="+encodeURIComponent(p.place_id),
        zoning:null,match:"unknown",evidence:TENANT_EVIDENCE[p.place_id]??null});
    }
  }
  if(!report.searchCount) throw new ZoningLookupError("Nearby business search is unavailable. The subject zoning is still available.");
  report.candidates=[...candidates.values()].sort((a,b)=>a.distanceMi-b.distanceMi).slice(0,12);
  // Bound both API spend and latency; two waves of at most six lookups.
  for(let start=0;start<report.candidates.length;start+=6) {
    await Promise.all(report.candidates.slice(start,start+6).map(async candidate=>{
      try {
        const found=await lookupZoneomics(candidate.point);
        candidate.zoning=found.zoning;candidate.match=compareProviderZoning(subject,found);
      }catch {candidate.match="unknown";}
    }));
  }
  report.warnings.push("Quick search: up to 12 nearest candidates from six business searches; not an exhaustive inventory.");
  const unknown=report.candidates.filter(c=>c.match==="unknown").length;
  if(unknown) report.warnings.push(unknown+" candidates could not be zoned and are excluded from matches.");
  if(report.searchCount<categories.length) report.warnings.push("Some business searches failed; results are partial.");
  return report;
}
