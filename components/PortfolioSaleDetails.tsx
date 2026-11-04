import Link from 'next/link';
export default function PortfolioSaleDetails({transaction,properties}:{transaction:any;properties:any[]}) {
 const p=transaction.portfolio_details||{};
 return <section className="panel">
  <h2>Portfolio transaction · {properties.length} constituent entries</h2>
  <p>Total consideration: ${Number(transaction.sale_price).toLocaleString()}. This is one sale transaction. Aggregate price, cap rate, building area and unit prices are portfolio-wide; they are excluded from single-property comparisons.</p>
  <p>Source page {p.sourcePage??'unknown'}, row {p.sourceRow??'unknown'} · Source reports: {p.reportedPropertyCount??'unknown'} {p.reportedCountKind||'properties/sites'}</p>
  {(p.warnings??[]).map((w:string)=><p key={w} className="hint">{w}</p>)}
  <details open><summary>Constituent properties and allocations</summary>
   {properties.map(x=><section key={x.id} id={`property-${x.id}`} className="panel-inset" style={{padding:12,marginTop:10}}>
    <h3>{x.address}{x.building_identifier?` · ${x.building_identifier}`:''}</h3>
    <p>Original address: {x.original_address} · Source page {x.source_page??'unknown'}, row {x.source_row??'unknown'}</p>
    <p>{x.allocated_price==null?'Price allocation unknown':`Source-reported component price: $${Number(x.allocated_price).toLocaleString()}`} · Building SF: {x.building_sf==null?'unknown':Number(x.building_sf).toLocaleString()} · Land acres: {x.lot_sf==null?'unknown':(Number(x.lot_sf)/43560).toFixed(2)}</p>
    <p>{x.latitude==null?'Location unresolved':`${Number(x.latitude).toFixed(6)}, ${Number(x.longitude).toFixed(6)} (${x.geocode_precision})`}{x.location_warning?` · ${x.location_warning}`:''}</p>
    {x.source_comp_id&&<Link href={`/comps/${x.source_comp_id}`}>Original component observation (linked; not counted again)</Link>}
    <details><summary>Original property-level source metrics</summary><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(x.source_metrics,null,2)}</pre></details>
   </section>)}
  </details>
 </section>;
}
