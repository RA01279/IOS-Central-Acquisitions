
import type {Point,Zoning} from "./types";
import type {Polygon} from "./geometry";
export type City={id:string;name:string;zoning:string;boundary:string;where:string;bounds:number[];code:string;description?:string;pd?:string};
export const CITIES:City[]=[
{id:"dallas-tx",name:"Dallas, TX",zoning:"https://gis.dallascityhall.com/arcgis/rest/services/sdc_public/Zoning/MapServer/15",boundary:"https://gis.dallascityhall.com/arcgis/rest/services/Pbw_public/ROWMSReferenceLayers/MapServer/2",where:"CITY = 'Dallas'",bounds:[32.5,33.08,-97.06,-96.45],code:"LONG_ZONE_DIST",description:"COMMON_NAME",pd:"PD_NUM"},
{id:"fort-worth-tx",name:"Fort Worth, TX",zoning:"https://mapit.fortworthtexas.gov/ags/rest/services/Planning_Development/Zoning/MapServer/25",boundary:"https://mapit.fortworthtexas.gov/ags/rest/services/Planning_Development/Zoning/MapServer/59",where:"UPPER(DESIGNATION) NOT LIKE '%ETJ%'",bounds:[32.5,33.2,-97.65,-97.05],code:"ZONING",description:"PD_DESCRIPTION",pd:"PD"},
{id:"austin-tx",name:"Austin, TX",zoning:"https://maps.austintexas.gov/gis/rest/Shared/Zoning_1/MapServer/0",boundary:"https://maps.austintexas.gov/gis/rest/Shared/JurisdictionsFill/MapServer/0",where:"CITY_NAME = 'CITY OF AUSTIN' AND JURISDICTION_TYPE_SPECIFICS IN ('FULL PURPOSE','LIMITED PURPOSE')",bounds:[30.05,30.65,-98,-97.5],code:"ZONING_ZTYPE",description:"ZONING_BASE"},
// Georgia. City of Atlanta Dept of City Planning (I-1 / I-2 industrial; SPI and PD-* in ZONECLASS).
{id:"atlanta-ga",name:"Atlanta, GA",zoning:"https://gis.atlantaga.gov/dpcd/rest/services/OpenDataService1/MapServer/22",boundary:"https://gis.atlantaga.gov/dpcd/rest/services/OpenDataService1/MapServer/1",where:"NAME = 'Atlanta'",bounds:[33.6475,33.887,-84.5516,-84.2895],code:"ZONECLASS",description:"ZONINGCODE"},
// Chatham County (SAGIS / Metropolitan Planning Commission): one countywide zoning layer, each
// jurisdiction picked out by the municipality boundary. Cities before unincorporated.
...["SAVANNAH","GARDEN CITY","POOLER","PORT WENTWORTH","BLOOMINGDALE","UNINCORPORATED"].map((n):City=>({
 id:`${n.toLowerCase().replace(/\s+/g,"-")}-chatham-ga`,
 name:n==="UNINCORPORATED"?"Unincorporated Chatham County, GA":`${n.replace(/\b(\w)(\w*)/g,(_,a:string,b:string)=>a+b.toLowerCase())}, GA`,
 zoning:"https://pub.sagis.org/arcgis/rest/services/OpenData/Boundaries/MapServer/4",
 boundary:"https://pub.sagis.org/arcgis/rest/services/OpenData/Boundaries/MapServer/6",
 where:`NAME = '${n}'`,bounds:[31.71,32.24,-81.4,-80.83],code:"ZONE",description:"ZONING_DISTRICT"})),
];
export function cityZoning(city:City,p:Point,matches:{attributes:Record<string,unknown>}[],pointSource:(layer:string,p:Point)=>string):Zoning {
 const a=matches[0]?.attributes??{};
 const value=(key?:string)=>key&&a[key]!=null?String(a[key]).trim():"";
 const boundary=new URL(pointSource(city.boundary,p));boundary.searchParams.set("where",city.where);
 return {provider:city.name,municipalityId:city.id,modifiersVerified:false,district:value(city.code),description:value(city.description),plannedDevelopment:value(city.pd),specialUse:"",subarea:"",overlays:[],caseNumber:value("CASE_NUMBER"),ordinance:value("ORDINANCE_NO")||value("ORD_NUM"),sourceUrl:pointSource(city.zoning,p),boundaryUrl:boundary.toString(),overlayUrl:"",status:matches.length>1?"ambiguous":matches.length===1&&value(city.code)?"mapped":"unknown"};
}
