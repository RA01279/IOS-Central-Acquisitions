"use client";
import CompDateInput from './CompDateInput';
import LocationPreview from './LocationPreview';
import { validCoordinates } from '@/lib/location';
import { isAddressRange, portfolioWarnings, type SalePortfolioDraft, type SalePropertyDraft } from '@/lib/comps/portfolios';
export default function PortfolioSaleReview({draft:d,update,issue}:{draft:any;update:(patch:any)=>void;issue:string|null}) {
 const p=d.portfolio as SalePortfolioDraft & {reviewAcknowledged?:boolean};
 const change=(patch:any)=>update((latest:any)=>({...patch,portfolio:{...latest.portfolio,...patch.portfolio,reviewAcknowledged:false}}));
 const property=(index:number,patch:Partial<SalePropertyDraft>)=>update((latest:any)=>{
   const current=latest.portfolio.properties[index],original=p.properties[index];
   if(!current)return {};
   if(('latitude'in patch||'longitude'in patch)&&(current.address!==original.address||current.buildingIdentifier!==original.buildingIdentifier||latest.city!==d.city||latest.state!==d.state||latest.market!==d.market))return {};
   return {portfolio:{...latest.portfolio,reviewAcknowledged:false,properties:latest.portfolio.properties.map((x:SalePropertyDraft,i:number)=>i===index?{...x,...patch}:x)}};
 });
 const numeric=(label:string,key:string)=><label>{label}<input type="number" min="0" step="any" value={d[key]??''} onChange={e=>change({[key]:e.target.value===''?null:Number(e.target.value)})}/></label>;
 return <section className="panel-inset portfolio-review" style={{padding:16,whiteSpace:'normal'}}>
  <label><input type="checkbox" checked={d._include} onChange={e=>update({_include:e.target.checked})}/> Include sale transaction</label>
  <h3>{p.name} · portfolio transaction</h3>
  <p>One transaction, {p.properties.length} extracted address/building entries{p.reportedPropertyCount?`; source reports ${p.reportedPropertyCount} ${p.reportedCountKind||'properties/sites'}`:''}. Aggregate consideration and metrics are excluded from single-property underwriting.</p>
  <div className="grid-2">
   <label>Portfolio name<input value={p.name} onChange={e=>change({address:e.target.value,projectName:e.target.value,portfolio:{name:e.target.value}})}/></label>
   <label>Asset class<select value={d.assetClass||''} onChange={e=>change({assetClass:e.target.value})}><option value="">Choose class</option><option value="ios">IOS</option><option value="industrial">Industrial</option></select></label>
   {numeric('Total transaction consideration ($)','salePrice')}{numeric('Aggregate building SF','buildingSf')}{numeric('Aggregate land acres','acres')}
   <label>Sale date<CompDateInput value={d.closedOn} precision={d.datePrecision} onChange={(v,precision)=>change({closedOn:v,datePrecision:precision})}/></label>
   {([['buyer','Buyer'],['seller','Seller'],['city','City'],['state','State'],['market','Market']] as const).map(([k,label])=><label key={k}>{label}<input value={d[k]||''} onChange={e=>change({[k]:e.target.value})}/></label>)}
  </div>
  <details><summary>Constituent properties and source-reported allocations ({p.properties.length})</summary>
   {p.properties.map((x,index)=><section key={index} className="panel-inset" style={{padding:12,marginTop:10}}>
    <strong>Property entry {index+1} · {x.allocationStatus==='source_reported'?'source-reported allocation':'allocation unknown'}</strong>
    <p>Source page {x.sourcePage??'unknown'}, row {x.sourceRow??'unknown'} · Original: {x.originalAddress}</p>
    <div className="grid-2">
     <label>Property address<input value={x.address} onChange={e=>property(index,{address:e.target.value,latitude:null,longitude:null})}/></label>
     <label>Building identifier<input value={x.buildingIdentifier??''} onChange={e=>property(index,{buildingIdentifier:e.target.value||null})}/></label>
     <label>Allocation status<select value={x.allocationStatus} onChange={e=>property(index,{allocationStatus:e.target.value as SalePropertyDraft['allocationStatus'],allocatedPrice:null})}><option value="unknown">Unknown — no allocation reported</option><option value="source_reported">Source-reported component price</option></select></label>
     <label>Property allocation ($)<input type="number" step="any" min="0" disabled={x.allocationStatus==='unknown'} value={x.allocatedPrice??''} onChange={e=>property(index,{allocatedPrice:e.target.value===''?null:Number(e.target.value)})}/></label>
     <label>Property building SF<input type="number" min="0" step="any" value={x.buildingSf??''} onChange={e=>property(index,{buildingSf:e.target.value===''?null:Number(e.target.value)})}/></label>
     <label>Property land acres<input type="number" min="0" step="any" value={x.acres??''} onChange={e=>property(index,{acres:e.target.value===''?null:Number(e.target.value)})}/></label>
    </div>
    {isAddressRange(x.address)&&<p className="hint">Address range retained as reported. No intermediate addresses or site count inferred; location requires review.</p>}
    {x.buildingIdentifier&&p.properties.filter(other=>other.address===x.address).length>1&&<p className="hint">Shared street-address location. Individual building footprints are not independently verified.</p>}
    <LocationPreview key={JSON.stringify([x.address,d.city,d.state,d.market])} locationRequired={false} allowLookup={!isAddressRange(x.address)} address={x.address} city={d.city} state={d.state} market={d.market} value={validCoordinates(x)?{latitude:Number(x.latitude),longitude:Number(x.longitude),geocode_precision:x.geocodePrecision||'supplied'}:null} onChange={loc=>property(index,{latitude:loc?.latitude??null,longitude:loc?.longitude??null,geocodePrecision:loc?.geocode_precision??null})}/>
    {x.locationWarning&&<p className="hint">{x.locationWarning}</p>}
    <details><summary>Original property-level source metrics</summary><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(x.sourceMetrics,null,2)}</pre></details>
    <button type="button" className="secondary" onClick={()=>change({portfolio:{properties:p.properties.filter((_,i)=>i!==index)}})}>Remove this entry</button>
   </section>)}
   <button type="button" className="secondary" onClick={()=>change({portfolio:{properties:[...p.properties,{address:'',buildingIdentifier:null,originalAddress:'Reviewer-added entry',sourcePage:p.sourcePage,sourceRow:null,allocationStatus:'unknown',allocatedPrice:null,buildingSf:null,acres:null,capRate:null,sourceMetrics:{}}]}})}>Add an explicitly identified property</button>
  </details>
  {[...new Set([...(d.warnings??[]),...(p.warnings??[]),...portfolioWarnings(p,d.salePrice)])].map(w=><p key={String(w)} className="hint">{String(w)}</p>)}
  <details><summary>Original transaction evidence · page {p.sourcePage??'unknown'}, row {p.sourceRow??'unknown'}</summary><pre style={{whiteSpace:'pre-wrap'}}>{d.notes}</pre></details>
  <label><input type="checkbox" checked={!!p.reviewAcknowledged} onChange={e=>{const checked=e.target.checked;update((latest:any)=>({portfolio:{...latest.portfolio,reviewAcknowledged:checked}}));}}/> I reviewed constituent addresses, allocation status and unresolved source discrepancies.</label>
  {issue&&<p className="error">{issue}</p>}
 </section>;
}
