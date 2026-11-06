import { compIssue } from './intake-validation';
import { validCoordinates } from '../location';
import { locateMany } from '../locate-site';
import { isAddressRange, portfolioWarnings } from './portfolios';
import {canonicalMarket,marketAt} from '../markets';

/** Auth is enforced by the calling route; RPC is service-only and atomic. */
export async function savePortfolioBatch(db:any, comps:any[],email:string,source:string,sourceRef:string|null) {
 const result:any={saved:0,duplicates:0,held:0,savedComps:[],completedKeys:[],rejected:[],failed:[],geocoding:{centroidOnly:0,failed:0,fromFile:0}};
 for(const c of comps) {
  const issue=compIssue(c);
  if(issue){result.rejected.push({address:c.address,reason:issue});continue;}
  const properties=c.portfolio.properties;
  c.market=canonicalMarket(c.market,c.city);
  c.portfolio.warnings=[...new Set([...(c.warnings??[]),...(c.portfolio.warnings??[]),...portfolioWarnings(c.portfolio,c.salePrice)])];
  const need=properties.filter((p:any)=>!validCoordinates(p)&&!isAddressRange(p.address));
  const locations=await locateMany(need,(p:any)=>({address:p.address,city:c.city,state:c.state,market:c.market}));let index=0;
  const propertyData=properties.map((p:any)=>{
   const supplied=validCoordinates(p),range=isAddressRange(p.address);
   const location=!supplied&&!range?locations[index++]:null;
   const latitude=supplied?Number(p.latitude):location?.found?location.latitude:null;
   const longitude=supplied?Number(p.longitude):location?.found?location.longitude:null;
   return {address:p.address.trim(),building_identifier:p.buildingIdentifier||null,original_address:p.originalAddress||p.address,source_page:p.sourcePage??null,source_row:p.sourceRow??null,allocation_status:p.allocationStatus,allocated_price:p.allocatedPrice??null,building_sf:p.buildingSf??null,lot_sf:p.acres==null?null:Math.round(p.acres*43560),cap_rate:p.capRate??null,source_metrics:p.sourceMetrics??{},latitude,longitude,geocode_precision:supplied?(p.geocodePrecision||'supplied'):location?.found?location.precision:null,location_warning:range&&!supplied?'Address range retained; individual sites unresolved. Review and place a verified pin only if the represented property is known.':location&&!location.found?location.reason:null};
  });
  // No market typed or read off the city: take it from the properties' pins
  // (the first one that lands in a metro we cover).
  if(!c.market)c.market=propertyData.map((p:any)=>marketAt(p.latitude,p.longitude,c.city)).find(Boolean)??null;
  const transaction={address:c.portfolio.name,project_name:c.portfolio.name,closed_on:c.closedOn,date_precision:c.datePrecision||'day',sale_price:c.salePrice,buyer:c.buyer||null,seller:c.seller||null,building_sf:c.buildingSf??null,lot_sf:c.lotSf??(c.acres==null?null:Math.round(c.acres*43560)),coverage_pct:c.coveragePct??null,cap_rate:c.capRate??null,city:c.city||null,state:c.state||null,market:c.market||null,asset_class:c.assetClass,notes:c.notes||null,source:['manual','excel','email','import'].includes(source)?source:'import',source_ref:c.sourceRef||sourceRef,created_by:email,portfolio_details:{...c.portfolio,properties:undefined,warnings:[...new Set([...(c.portfolio.warnings??[]),...portfolioWarnings(c.portfolio)])]}};
  const {data,error}=await db.rpc('save_comp_sale_portfolio',{transaction_data:transaction,property_data:propertyData});
  if(error){result.failed.push({address:c.address,reason:error.message});continue;}
  if(data.duplicate)result.duplicates++;else {result.saved++;result.savedComps.push({id:data.id,address:transaction.address,status:'confirmed',comparison_scope:'portfolio',properties:propertyData});}
  if(c._key)result.completedKeys.push(c._key);
  result.geocoding.failed+=propertyData.filter((p:any)=>p.latitude==null).length;
 }
 return result;
}
