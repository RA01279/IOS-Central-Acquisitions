import nextEnv from "@next/env";
import { readFileSync, writeFileSync } from "node:fs";
nextEnv.loadEnvConfig(process.cwd());
const rows=JSON.parse(readFileSync("docs/map-location-audit.json","utf8")).unresolved;
const output=[];
for(const row of rows){
  const url=new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address",[row.address,row.city].filter(Boolean).join(", "));
  url.searchParams.set("components","country:US");url.searchParams.set("key",process.env.GOOGLE_MAPS_SERVER_KEY);
  const res=await fetch(url,{signal:AbortSignal.timeout(8000)});const data=await res.json();
  output.push({id:row.id,address:row.address,city:row.city,status:data.status,results:(data.results??[]).map(r=>({formatted:r.formatted_address,partial:r.partial_match,precision:r.geometry.location_type,point:r.geometry.location,types:r.types,components:r.address_components}))});
}
writeFileSync("docs/google-location-candidates.json",JSON.stringify(output,null,2));
console.log(JSON.stringify(output.map(r=>({...r,results:r.results.map(({components,...rest})=>rest)})),null,2));
