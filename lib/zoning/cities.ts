
import type {Point,Zoning} from "./types";
import type {Polygon} from "./geometry";
export type City={id:string;name:string;zoning:string;boundary:string;where:string;bounds:number[];code:string;description?:string;pd?:string};
export const CITIES:City[]=[
{id:"dallas-tx",name:"Dallas, TX",zoning:"https://gis.dallascityhall.com/arcgis/rest/services/sdc_public/Zoning/MapServer/15",boundary:"https://gis.dallascityhall.com/arcgis/rest/services/Pbw_public/ROWMSReferenceLayers/MapServer/2",where:"CITY = 'Dallas'",bounds:[32.5,33.08,-97.06,-96.45],code:"LONG_ZONE_DIST",description:"COMMON_NAME",pd:"PD_NUM"},
{id:"fort-worth-tx",name:"Fort Worth, TX",zoning:"https://mapit.fortworthtexas.gov/ags/rest/services/Planning_Development/Zoning/MapServer/25",boundary:"https://mapit.fortworthtexas.gov/ags/rest/services/Planning_Development/Zoning/MapServer/59",where:"UPPER(DESIGNATION) NOT LIKE '%ETJ%'",bounds:[32.5,33.2,-97.65,-97.05],code:"ZONING",description:"PD_DESCRIPTION",pd:"PD"},
{id:"austin-tx",name:"Austin, TX",zoning:"https://maps.austintexas.gov/gis/rest/Shared/Zoning_1/MapServer/0",boundary:"https://maps.austintexas.gov/gis/rest/Shared/JurisdictionsFill/MapServer/0",where:"CITY_NAME = 'CITY OF AUSTIN' AND JURISDICTION_TYPE_SPECIFICS IN ('FULL PURPOSE','LIMITED PURPOSE')",bounds:[30.05,30.65,-98,-97.5],code:"ZONING_ZTYPE",description:"ZONING_BASE"}
];
export function cityZoning(city:City,p:Point,matches:{attributes:Record<string,unknown>}[],pointSource:(layer:string,p:Point)=>string):Zoning {
 const a=matches[0]?.attributes??{};
 const value=(key?:string)=>key&&a[key]!=null?String(a[key]).trim():"";
 const boundary=new URL(pointSource(city.boundary,p));boundary.searchParams.set("where",city.where);
 return {provider:city.name,municipalityId:city.id,modifiersVerified:false,district:value(city.code),description:value(city.description),plannedDevelopment:value(city.pd),specialUse:"",subarea:"",overlays:[],caseNumber:value("CASE_NUMBER"),ordinance:value("ORDINANCE_NO")||value("ORD_NUM"),sourceUrl:pointSource(city.zoning,p),boundaryUrl:boundary.toString(),overlayUrl:"",status:matches.length>1?"ambiguous":matches.length===1&&value(city.code)?"mapped":"unknown"};
}
