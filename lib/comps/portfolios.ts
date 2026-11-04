/** A property observation belongs to a transaction; aggregate money never lives here. */
export interface SalePropertyDraft {
  address: string; buildingIdentifier: string | null; originalAddress: string;
  sourcePage: number | null; sourceRow: number | null;
  allocationStatus: "unknown" | "source_reported";
  allocatedPrice: number | null; buildingSf: number | null; acres: number | null;
  capRate: number | null; sourceMetrics: Record<string, string>;
  latitude?: number | null; longitude?: number | null; geocodePrecision?: string | null;
  locationWarning?: string | null;
}
export interface SalePortfolioDraft {
  name: string; originalAddress: string; sourcePage: number | null; sourceRow: number | null;
  reportedPropertyCount: number | null; reportedCountKind?:string|null; properties: SalePropertyDraft[];
  sourceMetrics: Record<string, string>; warnings: string[];
}
export const addressKey = (v: string) => v.toLowerCase().replace(/[–—]/g,'-').replace(/\b(lane|road|street|drive)\b/g, m=>({lane:'ln',road:'rd',street:'st',drive:'dr'}[m]!)).replace(/[^a-z0-9-]/g,'');
export const isAddressRange = (v: string) => /\b\d+\s*[-–]\s*\d+\s+/.test(v);

/** Only enumerated building letters are expanded. Street-number ranges stay intact. */
export function constituentAddresses(original: string): {address:string;buildingIdentifier:string|null;originalAddress:string}[] {
  const rawFragments=original.split(/\s*,\s*|\s+(?:&|and)\s+(?=\d)/i).map(f=>{const index=f.search(/\b\d{2,6}(?:\s*[-–]\s*\d{2,6})?\s+/);return index<0?'':f.slice(index).trim();});
  const sourceText=(address:string)=>rawFragments.find(f=>addressKey(f)===addressKey(address))||address;
  let text=original.replace(/\s*\n\s*/g,' ').replace(/(\d)\s*[-–]\s*(\d)/g,'$1-$2').replace(/\s+/g,' ').replace(/,?\s*Houston,?\s*TX.*$/i,'').trim();
  const out: ReturnType<typeof constituentAddresses> = [];
  const shared=/(\d+)\s+([A-Z](?:,\s*[A-Z])*,?\s*&\s*[A-Z])\s+([^,]+)(?:,|$)/g;
  text=text.replace(shared,(full,number,letters,street)=>{
    for(const letter of (letters.match(/[A-Z]/g) ?? [])) out.push({address:`${number} ${street.trim()}`,buildingIdentifier:`Bldg. ${letter}`,originalAddress:original});
    return '';
  });
  const start=text.search(/\b\d{2,6}(?:-\d{2,6})?\s+/);
  if(start>=0) text=text.slice(start); else text='';
  for(const fragment of text.split(/\s*,\s*|\s+(?:&|and)\s+(?=\d)/i)) {
    const address=fragment.replace(/^(?:&|and)\s*/i,'').trim();
    if(/^\d{2,6}(?:-\d{2,6})?\s+\S/.test(address)) out.push({address,buildingIdentifier:null,originalAddress:sourceText(address)});
  }
  return out;
}
function reportedCount(notes: string): {count:number;kind:string}|null {
  const m=notes.match(/(?:consist(?:ing|s)?\s+of|features|across)\s+(\d+|three|five|six|eleven)\s+(?:single[ -]tenant\s+|industrial\s+|IOS\s+)?(properties|assets|buildings|sites)/i);
  return m ? {count:({three:3,five:5,six:6,eleven:11}[m[1].toLowerCase()] ?? Number(m[1])),kind:m[2].toLowerCase()} : null;
}
export function portfolioWarnings(p: SalePortfolioDraft,totalConsideration?:number): string[] {
  const warnings=[];
  if(!p.properties.length)warnings.push('No constituent address could be extracted. Enter explicitly identified properties; the portfolio name is not a property location.');
  const ranged=p.properties.filter(x=>isAddressRange(x.address));
  if(p.reportedPropertyCount && (p.properties.length!==p.reportedPropertyCount || ranged.length)) warnings.push(`Source reports ${p.reportedPropertyCount} ${p.reportedCountKind||'properties/sites'}; ${p.properties.length} address/building entries extracted${ranged.length ? `, including ${ranged.length} unexpanded range(s)` : ''}. Address coverage requires review; no missing sites were invented.`);
  if(p.properties.some(x=>x.allocatedPrice==null)) warnings.push('Property allocations unknown. Portfolio consideration, cap rate and unit prices apply only to the transaction.');
  if(p.properties.length&&p.properties.every(x=>x.allocatedPrice!=null)&&totalConsideration!=null){const total=p.properties.reduce((s,x)=>s+Number(x.allocatedPrice),0);if(Math.abs(total-totalConsideration)>.01)warnings.push(`Source-reported component prices total $${total.toLocaleString()} versus $${totalConsideration.toLocaleString()} transaction consideration. Reconcile the source; no balancing allocation was invented.`);}
  return warnings;
}

/** Reconcile a portfolio and component rows in ONE source, never by price alone. */
export function groupPortfolioSales<T extends Record<string, any>>(rows: T[]): T[] {
  const consumed=new Set<T>(); const portfolios=new Map<T,SalePortfolioDraft>();
  for(const row of rows) {
    if(row.compType!=='sale' || row.portfolio || !/portfolio/i.test(`${row.projectName??''} ${row.address??''} ${row.notes??''}`)) continue;
    const original=row.originalAddress ?? row.sourceBuilding ?? row.address;
    const addresses=constituentAddresses(original);
    if(addresses.length<2&&!/portfolio/i.test(`${row.projectName??''} ${row.address??''}`)&&! /portfolio\s+(?:consist|is\s+comprised|features)/i.test(row.notes??'')) continue;
    const name=row.projectName || original.slice(0,original.search(/\b\d{2,6}/)).trim() || 'Sale portfolio';
    const count=reportedCount(row.notes??'');
    const p:SalePortfolioDraft={name,originalAddress:original,sourcePage:row.sourcePage??null,sourceRow:row.sourceRow??null,reportedPropertyCount:count?.count??null,reportedCountKind:count?.kind??null,sourceMetrics:row.sourceMetrics??{},warnings:[],properties:[]};
    for(const a of addresses) {
      const components=rows.filter(c=>c!==row && c.compType==='sale' && addressKey(c.address)===addressKey(a.address) && (c.closedOn??'')===(row.closedOn??'') && (c.buyer??'').toLowerCase()===(row.buyer??'').toLowerCase() && (c.seller??'').toLowerCase()===(row.seller??'').toLowerCase() && !c.portfolio);
      const component=components.length===1?components[0]:null;
      if(component){consumed.add(component);p.warnings.push(...(component.warnings??[]).map((w:string)=>`Component source row ${component.sourceRow??'unknown'}: ${w}`));}
      p.properties.push({...a,originalAddress:component?.originalAddress||a.originalAddress,sourcePage:component?.sourcePage??p.sourcePage,sourceRow:component?.sourceRow??p.sourceRow,allocationStatus:component?.salePrice ? 'source_reported':'unknown',allocatedPrice:component?.salePrice??null,buildingSf:component?.buildingSf??null,acres:component?.acres??null,capRate:component?.capRate??null,sourceMetrics:component?.sourceMetrics??{}});
      if(components.length>1) p.warnings.push(`Multiple component rows match ${a.address}; reconcile allocations manually.`);
    }
    const allocated=p.properties.filter(x=>x.allocatedPrice!=null);
    if(allocated.length===p.properties.length && Math.abs(allocated.reduce((s,x)=>s+x.allocatedPrice!,0)-Number(row.salePrice))>.01) p.warnings.push('Source-reported component prices do not reconcile to transaction consideration.');
    p.warnings.push(...portfolioWarnings(p)); portfolios.set(row,p);
  }
  return rows.filter(r=>!consumed.has(r)).map(row=>{
    const p=portfolios.get(row); if(!p)return row;
    return {...row,address:p.name,projectName:p.name,latitude:null,longitude:null,portfolio:p,warnings:[...(row.warnings??[]),...p.warnings]};
  });
}

export function applyPortfolioHints(rows:any[],hints:unknown):any[] {
 if(!Array.isArray(hints))return rows;
 return rows.map((row,index)=>{
  const hint=hints.find(h=>h&&h.saleRow===index);
  if(!hint || row.compType!=='sale')return row;
  if(typeof hint.name!=='string'||!hint.name.trim()||!Array.isArray(hint.properties)||!hint.properties.length||hint.properties.length>100)throw Error('Invalid portfolio extraction; review the source and correct the constituent list.');
  const p:SalePortfolioDraft={name:hint.name,originalAddress:typeof hint.originalAddress==='string'?hint.originalAddress:row.address,sourcePage:hint.sourcePage??null,sourceRow:hint.sourceRow??null,reportedPropertyCount:hint.reportedPropertyCount??null,sourceMetrics:hint.sourceMetrics??{},warnings:Array.isArray(hint.warnings)?hint.warnings.filter((v:unknown)=>typeof v==='string'):[],properties:hint.properties.map((x:any)=>({address:String(x.address??''),buildingIdentifier:x.buildingIdentifier??null,originalAddress:x.originalAddress||String(x.address??''),sourcePage:x.sourcePage??hint.sourcePage??null,sourceRow:x.sourceRow??null,allocationStatus:x.allocationStatus==='source_reported'?'source_reported':'unknown',allocatedPrice:x.allocatedPrice??null,buildingSf:x.buildingSf??null,acres:x.acres??null,capRate:x.capRate??null,sourceMetrics:x.sourceMetrics??{}}))};
  p.warnings.push(...portfolioWarnings(p));return {...row,address:p.name,projectName:p.name,latitude:null,longitude:null,portfolio:p};
 });
}

/** Safe map projection: only explicit property allocations are shown as money. */
export function portfolioMapRows(transactions: any[], properties: any[]): any[] {
  return transactions.filter(t=>!t.portfolio_transaction_id).flatMap(t=>t.is_portfolio
    ? properties.filter(p=>p.sale_comp_id===t.id).map(p=>({...t,id:p.id,transaction_id:t.id,portfolio_name:t.project_name||t.address,address:p.address,project_name:p.building_identifier,latitude:p.latitude,longitude:p.longitude,geocode_precision:p.geocode_precision,sale_price:p.allocated_price,building_sf:p.building_sf,lot_sf:p.lot_sf,coverage_pct:null,cap_rate:p.cap_rate,comparison_scope:'portfolio_property'}))
    : [{...t,transaction_id:t.id,comparison_scope:'property'}]);
}
