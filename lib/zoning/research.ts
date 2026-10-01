import { CITIES, cityZoning, type City } from "./cities";
import { containsPoint, distanceMiles, validPoint, type Polygon } from "./geometry";
import { TENANT_EVIDENCE } from "./evidence";
import type { Point, Zoning, ZoningCandidate, ZoningReport } from "./types";

const ROOT = "https://maps.planogis.org/arcgiswad/rest/services/OpenData";
const LAYERS = {
  zoning: ROOT + "/Zoning/MapServer/0",
  boundary: ROOT + "/MunicipalBoundary/MapServer/0",
  overlays: ROOT + "/OverlayDistricts/MapServer/0",
};
type Feature = { attributes: Record<string, unknown>; geometry: Polygon };
type Layers = { zoning: Feature[]; boundary: Feature[]; overlays: Feature[] };

async function lookupCity(p:Point):Promise<{subject:Zoning;city:City|null}> {
 if(p.lat>=32.96&&p.lat<=33.15&&p.lng>=-96.9&&p.lng<=-96.59) {
  const b=await fetchJson(pointSource(LAYERS.boundary,p));
  if(!Array.isArray(b.features)||b.exceededTransferLimit) throw new MunicipalResearchError("Municipal boundary information is incomplete.");
  if(b.features.some((f:Feature)=>f.attributes.NAME==="Plano")) return {subject:await lookupPlano(p),city:null};
 }
 for(const city of CITIES) {
  const [south,north,west,east]=city.bounds;
  if(p.lat<south||p.lat>north||p.lng<west||p.lng>east) continue;
  const url=new URL(pointSource(city.boundary,p));url.searchParams.set("where",city.where);
  const b=await fetchJson(url);
  if(!Array.isArray(b.features)||b.exceededTransferLimit) throw new MunicipalResearchError("Municipal boundary information is incomplete.");
  if(!b.features.length) continue;
  const z=await fetchJson(pointSource(city.zoning,p));
  if(!Array.isArray(z.features)||z.exceededTransferLimit) throw new MunicipalResearchError("Municipal zoning information is incomplete.");
  return {subject:cityZoning(city,p,z.features,pointSource),city};
 }
 throw new MunicipalResearchError("This municipality is not connected to instant lookup. Use U.S. zoning research below for a sourced report.");
}
async function loadCityLayers(city:City,p:Point,radius:number):Promise<Layers> {
 const dy=radius/69+0.01,dx=dy/Math.cos(p.lat*Math.PI/180);
 const envelope={geometry:[p.lng-dx,p.lat-dy,p.lng+dx,p.lat+dy].join(","),geometryType:"esriGeometryEnvelope",inSR:"4326",spatialRel:"esriSpatialRelIntersects"};
 const [zoning,boundary]=await Promise.all([features(city.zoning,envelope),features(city.boundary,{...envelope,where:city.where})]);
 return {zoning,boundary,overlays:[]};
}

export class MunicipalResearchError extends Error {}
const responseCache=new Map<string,{until:number;value:Promise<any>}>();
const CATEGORIES = [
  ["Equipment rental", "equipment rental"],
  ["Landscape supply", "landscape supply yard"],
  ["Building materials", "building materials supplier"],
  ["Stone / masonry", "stone yard"],
  ["Contractor operations", "paving contractor"],
  ["Contractor operations", "fence company"],
  ["Truck / trailer operations", "truck parking"],
  ["Truck / trailer operations", "towing service"],
  ["Container operations", "shipping container storage"],
  ["Pipe / steel supply", "pipe steel supply"],
] as const;

export async function fetchJson(url: URL | string) {
  const address=String(url), municipal=[ROOT,"https://gis.dallascityhall.com/","https://mapit.fortworthtexas.gov/","https://maps.austintexas.gov/"].some(root=>address.startsWith(root));
  const hit=responseCache.get(address);
  if(hit && hit.until>Date.now()) return hit.value;
  const value=(async()=>{
    let response;
    try {
      response=await fetch(url,municipal
        ? {next:{revalidate:3600},signal:AbortSignal.timeout(12000)}
        : {cache:"no-store",signal:AbortSignal.timeout(8000)});
    } catch { throw new MunicipalResearchError("A research source did not respond in time. Please retry."); }
    if(!response.ok) throw new MunicipalResearchError("A research source is temporarily unavailable. Please retry.");
    const data=await response.json();
    if(data.error || (data.status && !["OK","ZERO_RESULTS"].includes(data.status))) throw new MunicipalResearchError("A research source returned an error. Please retry.");
    return data;
  })();
  if(responseCache.size>=128) responseCache.delete(responseCache.keys().next().value!);
  responseCache.set(address,{until:Date.now()+(municipal?3600000:300000),value});
  try{return await value;}catch(e){responseCache.delete(address);throw e;}
}
function queryUrl(layer: string, params: Record<string,string>): URL {
  const u=new URL(layer+"/query");
  u.search=new URLSearchParams({f:"json",where:"1=1",outFields:"*",...params}).toString();
  return u;
}
export function pointSource(layer: string, p: Point): string {
  return queryUrl(layer,{geometry:`${p.lng},${p.lat}`,geometryType:"esriGeometryPoint",inSR:"4326",spatialRel:"esriSpatialRelIntersects",returnGeometry:"false"}).toString();
}
async function features(layer: string, params: Record<string,string>): Promise<Feature[]> {
  const data=await fetchJson(queryUrl(layer,{returnGeometry:"true",outSR:"4326",...params}));
  if (data.error || !Array.isArray(data.features) || data.exceededTransferLimit)
    throw new MunicipalResearchError("The municipal GIS returned an incomplete result. No zoning matches have been inferred.");
  return data.features;
}
export async function loadPlanoLayers(p: Point, radius: number): Promise<Layers> {
  const dy=radius/69+0.01, dx=dy/Math.cos(p.lat*Math.PI/180);
  const envelope={geometry:[p.lng-dx,p.lat-dy,p.lng+dx,p.lat+dy].join(","),geometryType:"esriGeometryEnvelope",inSR:"4326",spatialRel:"esriSpatialRelIntersects"};
  const [zoning,boundary,overlays]=await Promise.all([
    features(LAYERS.zoning,envelope),
    features(LAYERS.boundary,{where:"NAME = 'Plano'"}),
    features(LAYERS.overlays,envelope),
  ]);
  return {zoning,boundary,overlays};
}
const str = (v: unknown) => typeof v==="string" ? v.trim() : "";
export function zoningAt(p: Point, layers: Layers): Zoning | null {
  if (!layers.boundary.some(f=>containsPoint(p,f.geometry))) return null;
  const matches=layers.zoning.filter(f=>containsPoint(p,f.geometry));
  return zoningFromMatches(p,matches,layers.overlays.filter(f=>containsPoint(p,f.geometry)));
}
function zoningFromMatches(p:Point,matches:Feature[],overlays:Feature[]):Zoning {
  const a=matches[0]?.attributes ?? {};
  const ambiguous=matches.length>1;
  return {
    provider:"City of Plano",municipalityId:"plano-tx",modifiersVerified:true,
    district: ambiguous ? matches.map(f=>str(f.attributes.ZN)).join(" / ") : str(a.ZN),
    description: str(a.IMS_ZONE), specialUse:str(a.S), plannedDevelopment:str(a.PD),
    subarea:str(a.PD_Subarea), overlays: Array.from(new Set(overlays.map(f=>str(f.attributes.OVERLAY)))).sort(),
    caseNumber:str(a.ZONE_CASE), ordinance:str(a.ORDINANCENUM),
    sourceUrl:pointSource(LAYERS.zoning,p),boundaryUrl:pointSource(LAYERS.boundary,p),overlayUrl:pointSource(LAYERS.overlays,p),
    status:ambiguous ? "ambiguous" : matches.length!==1 || !str(a.ZN) || /researching/i.test(str(a.ZONE_CASE)) ? "unknown" : "mapped",
  };
}
export async function lookupPlano(point:Point):Promise<Zoning> {
  const [boundary,zoning,overlays]=await Promise.all([
    fetchJson(pointSource(LAYERS.boundary,point)),fetchJson(pointSource(LAYERS.zoning,point)),fetchJson(pointSource(LAYERS.overlays,point)),
  ]);
  for(const data of [boundary,zoning,overlays]) {
    if(!Array.isArray(data.features) || data.exceededTransferLimit)
      throw new MunicipalResearchError("Municipal GIS returned incomplete information. Please retry.");
  }
  if(!boundary.features.some((f:Feature)=>str(f.attributes.NAME)==="Plano"))
    throw new MunicipalResearchError("This location is outside Plano. Its municipality is not connected yet.");
  return zoningFromMatches(point,zoning.features,overlays.features);
}
export function compareZoning(subject: Zoning, candidate: Zoning | null): ZoningCandidate["match"] {
  if (!candidate) return "outside";
  if (subject.status!=="mapped" || candidate.status!=="mapped") return "unknown";
  if(subject.municipalityId && candidate.municipalityId && subject.municipalityId!==candidate.municipalityId) return "outside";
  if (subject.district!==candidate.district) return "different";
  const signature=(z:Zoning)=>JSON.stringify([z.specialUse,z.plannedDevelopment,z.subarea,[...z.overlays].sort()]);
  return signature(subject)===signature(candidate) ? (subject.modifiersVerified===false || candidate.modifiersVerified===false ? "same_code" : "same_designation") : "same_base";
}
async function runResearch(input: {dealId:string;address:string;point:Point;precision:string;radiusMiles:number}, includeNeighbors=true): Promise<ZoningReport> {
  const {point,radiusMiles}=input;
  if (!validPoint(point) || !["rooftop","manual","geometric_center"].includes(input.precision))
    throw new MunicipalResearchError("Verify the property's exact map pin before researching zoning.");
  if (![1,3,5].includes(radiusMiles)) throw new MunicipalResearchError("Choose a 1, 3 or 5 mile search radius.");
  const {subject,city}=await lookupCity(point);
  if (subject.status!=="mapped") throw new MunicipalResearchError("The subject zoning is missing, under research, or on a district boundary. Verify the parcel with the city before matching neighbors.");

  const warnings=[
    "Municipal GIS responses are cached for up to one hour; business searches for five minutes.",
    "Zoning is mapped at each location pin, not across the full parcel. Split zoning and parcels spanning multiple addresses need review.",
    "Business listings identify operators, not leasehold status. A search category alone does not establish outdoor storage at that site.",
    "Matching a zoning designation does not establish that the subject can operate the same use. Review special-use permits and site approvals.",
    "Discovery checks the first 20 results for each of 10 IOS-related searches; it is not an exhaustive property inventory.",
  ];
  const report:ZoningReport={schemaVersion:1,generatedAt:new Date().toISOString(),dealId:input.dealId,address:input.address,point,
    municipality:city?.name??"Plano, TX",radiusMiles,subject,candidates:[],warnings,searchCount:0};
  if(city) warnings.unshift("Published zoning code checked. Separate overlays, special-use permits and site approvals are not fully checked; code matches are not full-designation matches.");
  if(!includeNeighbors) return report;
  const key=process.env.GOOGLE_MAPS_SERVER_KEY;
  if(!key) throw new MunicipalResearchError("Nearby business search is not configured.");
  const layersResult=(city?loadCityLayers(city,point,radiusMiles):loadPlanoLayers(point,radiusMiles)).then(value=>({value,error:null}),error=>({value:null,error}));
  const searches=await Promise.allSettled(CATEGORIES.map(async([category,keyword])=>{
    const u=new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
    u.search=new URLSearchParams({location:`${point.lat},${point.lng}`,radius:String(radiusMiles*1609.344),keyword,key}).toString();
    const data=await fetchJson(u);
    if (!["OK","ZERO_RESULTS"].includes(data.status)) throw new MunicipalResearchError("Business search failed");
    return (data.results??[]).map((place:any)=>({place,category}));
  }));
  const successful=searches.filter(s=>s.status==="fulfilled").length;
  if (!successful) throw new MunicipalResearchError("Nearby business search is unavailable. Please retry.");
  if(successful<searches.length) warnings.push(`${searches.length-successful} business searches failed; results are partial.`);
  const loaded=await layersResult;
  if(loaded.error || !loaded.value) throw loaded.error??new MunicipalResearchError("Could not load municipal zoning.");
  const layers=loaded.value;
  const found=new Map<string,ZoningCandidate>();
  for(const result of searches) {
    if(result.status!=="fulfilled") continue;
    for(const {place,category} of result.value) {
      const p=place.geometry?.location as Point;
      if(!p || !validPoint(p) || !place.place_id || found.has(place.place_id) || place.business_status!=="OPERATIONAL") continue;
      const distanceMi=distanceMiles(point,p);
      if(distanceMi>radiusMiles || distanceMi<0.03) continue;
      if(/self.?storage|public storage|u-haul|home depot|lowe's|movers|moving company/i.test(place.name??"")) continue;
      const zoning=city ? (layers.boundary.some(f=>containsPoint(p,f.geometry)) ? cityZoning(city,p,layers.zoning.filter(f=>containsPoint(p,f.geometry)),pointSource) : null) : zoningAt(p,layers);
      found.set(place.place_id,{
        placeId:place.place_id,name:String(place.name),address:String(place.vicinity??""),point:p,distanceMi,
        category,mapsUrl:"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(place.name)+"&query_place_id="+encodeURIComponent(place.place_id),
        zoning,match:compareZoning(subject,zoning),evidence:TENANT_EVIDENCE[place.place_id]??null,
      });
    }
  }
  return {...report,candidates:[...found.values()].sort((a,b)=>a.distanceMi-b.distanceMi),searchCount:successful};
}

const reportCache=new Map<string,{until:number;value:Promise<ZoningReport>}>();
export async function researchZoning(input:Parameters<typeof runResearch>[0],includeNeighbors=true):Promise<ZoningReport> {
  const key=JSON.stringify([input,includeNeighbors]);
  const hit=reportCache.get(key);
  if(hit && hit.until>Date.now()) return hit.value;
  const value=runResearch(input,includeNeighbors);
  if(reportCache.size>=64) reportCache.delete(reportCache.keys().next().value!);
  reportCache.set(key,{until:Date.now()+300000,value});
  try{return await value;}catch(e){reportCache.delete(key);throw e;}
}
