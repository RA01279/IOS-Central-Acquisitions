import Link from 'next/link';
import Nav from '@/components/Nav';
import {getCurrentUser} from '@/lib/auth';
import {getServiceClient} from '@/lib/supabase';
import {redirect} from 'next/navigation';
import TaxCoverageActions from '@/components/property-taxes/TaxCoverageActions';
import {BarRows, SERIES, SERIES_SOFT, Stat} from '@/components/charts';
export const dynamic='force-dynamic';

// Property tax coverage across current deals and owned assets. The summary at
// the top only counts what the table below states (parcel sets on file, saved
// account figures, open authority/supplement gaps, retrieval status); it makes
// no claim of verification. The table is filterable and shows 50 rows at a time.

type Filter='all'|'unresearched'|'noparcels'|'gaps'|'failed';
const FILTERS:Record<Filter,string>={all:'All',unresearched:'Not researched',noparcels:'Parcel set unresolved',gaps:'With gaps',failed:'Retrieval failed'};
const PAGE=50;
/** "needs_review" -> "Needs review", for chart labels. */
const pretty=(s:string)=>{const t=s.replace(/_/g,' ');return t.charAt(0).toUpperCase()+t.slice(1);};

export default async function TaxCoveragePage(props:{searchParams:Promise<{show?:string;all?:string}>}){
 if(!await getCurrentUser())redirect('/login');const db=getServiceClient();
 const sp=await props.searchParams;
 const filter:Filter=(Object.keys(FILTERS) as Filter[]).find(f=>f===sp.show)??'all';
 const [subjects,jobs,jurisdictions,deals,assets]=await Promise.all([
  // Never fetch every original's extraction text for an inventory summary.
  db.from('property_tax_subjects').select('subject_kind,subject_id,parcels:state->parcels,records:state->records,updated_at').limit(1000),
  db.from('property_tax_jobs').select('*').limit(1000),db.from('property_tax_jurisdictions').select('*').order('jurisdiction').limit(500),
  db.from('deals').select('id,property_id,stage,properties(address,city)').neq('stage','archived').limit(1000),db.from('assets').select('id,address,city,status').neq('status','sold').limit(1000)
 ]);const error=[subjects,jobs,jurisdictions,deals,assets].find(r=>r.error)?.error;
 const base=[...(deals.data??[]).map((d:any)=>({kind:'property',id:d.property_id,address:d.properties?.address??'Address unresolved',city:d.properties?.city,href:`/deals/${d.id}/property-taxes`})),...(assets.data??[]).map(a=>({kind:'asset',id:a.id,address:a.address,city:a.city,href:`/property-taxes/asset/${a.id}`}))];
 // Everything each row shows, worked out once so the summary and the table agree.
 const rows=base.map(r=>{const s:any=subjects.data?.find(s=>s.subject_kind===r.kind&&s.subject_id===r.id),job:any=jobs.data?.find(j=>j.subject_kind===r.kind&&j.subject_id===r.id),parcels:any[]=s?.parcels??[],records:any[]=s?.records??[],bills=records.filter(x=>typeof x.facts?.levied?.value==='number'),years=[...new Set(bills.map(x=>x.year))].sort((a,b)=>b-a),gaps=bills.filter(x=>x.billEvidence?.obligationStatus!=='reconciled').length;
  return {...r,s,job,parcels,bills,years,gaps,status:(job?.status as string|undefined)??'Not queued'};});
 const n=(f:(r:typeof rows[number])=>boolean)=>rows.filter(f).length;
 const researched=n(r=>!!r.s),withParcels=n(r=>r.parcels.length>0),withBills=n(r=>r.bills.length>0),withGaps=n(r=>r.gaps>0);
 const failed=(r:typeof rows[number])=>/fail|error/i.test(r.status)||!!r.job?.outcome?.error;
 const match:Record<Filter,(r:typeof rows[number])=>boolean>={all:()=>true,unresearched:r=>!r.s,noparcels:r=>!!r.s&&!r.parcels.length,gaps:r=>r.gaps>0,failed};
 const counts=Object.fromEntries((Object.keys(FILTERS) as Filter[]).map(f=>[f,n(match[f])])) as Record<Filter,number>;
 const filtered=rows.filter(match[filter]);const showAll=sp.all==='1'||filtered.length<=PAGE+10;const visible=showAll?filtered:filtered.slice(0,PAGE);
 const statuses=[...new Set(rows.map(r=>r.status))].map(s=>({s,n:n(r=>r.status===s)})).sort((a,b)=>b.n-a.n);
 const jStatuses=[...new Set((jurisdictions.data??[]).map((j:any)=>String(j.status)))].map(s=>({s,n:(jurisdictions.data??[]).filter((j:any)=>String(j.status)===s).length})).sort((a,b)=>b.n-a.n);
 const href=(patch:Record<string,string|null>)=>{const p=new URLSearchParams();for(const[k,v]of Object.entries({show:filter!=='all'?filter:null,...patch}))if(v)p.set(k,v);const q=p.toString();return `/property-taxes${q?`?${q}`:''}`;};
 const total=rows.length||1;
 return <><Nav/><main className="wide" style={{maxWidth:1400,margin:'32px auto',padding:'0 24px'}}>
 <h1>Property tax coverage</h1><p>Current deals and owned assets. Saved account figures, factual review and automation are separate measures. Open a property for source-validated coverage and capture provenance.</p>
 {error?<p role="alert">Coverage storage unavailable: {error.message}</p>:<>
 <div className="stat-grid-auto">
  <Stat label="Current deals and assets" value={rows.length} sub={`${(deals.data??[]).length} deals · ${(assets.data??[]).length} assets`}/>
  <Stat label="Researched" value={researched} sub={`${Math.round(researched/total*100)}%`} href={href({show:null})}/>
  <Stat label="Parcel set on file" value={withParcels} sub={`${Math.round(withParcels/total*100)}%`}/>
  <Stat label="With saved account figures" value={withBills} sub={`${Math.round(withBills/total*100)}%`}/>
  <Stat label="With authority/supplement gaps" value={withGaps} href={href({show:'gaps',all:null})}/>
 </div>
 <div className="two-col">
  <section className="panel"><h2>Coverage, step by step</h2>
   <BarRows labelWidth={190} max={rows.length||1} rows={[
    {key:'all',label:'Current deals and assets',segments:[{value:rows.length,color:SERIES_SOFT}],value:rows.length},
    {key:'res',label:'Researched',segments:[{value:researched,color:SERIES_SOFT}],value:<>{researched} <span className="muted">· {Math.round(researched/total*100)}%</span></>},
    {key:'par',label:'Parcel set on file',segments:[{value:withParcels,color:SERIES[0]}],value:<>{withParcels} <span className="muted">· {Math.round(withParcels/total*100)}%</span></>},
    {key:'bill',label:'Saved account figures',segments:[{value:withBills,color:SERIES[0]}],value:<>{withBills} <span className="muted">· {Math.round(withBills/total*100)}%</span></>},
    {key:'clean',label:'Figures with no open gaps',segments:[{value:withBills-withGaps,color:SERIES[0]}],value:<>{withBills-withGaps} <span className="muted">· {Math.round((withBills-withGaps)/total*100)}%</span></>},
   ]}/>
   <p className="hint" style={{marginBottom:0,marginTop:12}}>Counts of what is on file. Original-record and parcel review is still required for every property.</p>
  </section>
  <section className="panel"><h2>Retrieval status</h2>
   <BarRows labelWidth={150} rows={statuses.map(({s,n})=>({key:s,label:pretty(s),segments:[{value:n,color:/fail|error/i.test(s)?'var(--weak)':s==='Not queued'?'var(--n400)':SERIES[0]}],value:n}))}/>
   {jStatuses.length?<><h3 className="report-sub">Jurisdictions by onboarding status</h3>
   <BarRows labelWidth={150} rows={jStatuses.map(({s,n})=>({key:s,label:pretty(s),segments:[{value:n,color:SERIES_SOFT}],value:n}))}/></>:null}
  </section>
 </div>
 <section className="panel">
 <div className="filter-chips" style={{marginTop:0}}>{(Object.keys(FILTERS) as Filter[]).map(f=><Link key={f} href={href({show:f==='all'?null:f,all:null})} className={filter===f?'chip chip-active':'chip'}>{FILTERS[f]} <span className="tchip-count">{counts[f]}</span></Link>)}</div>
 {filtered.length===0?<p className="hint">Nothing matches this filter.</p>:
 <div className="table-scroll"><table className="summary-table log-table"><thead><tr><th>Property</th><th>Jurisdictions / accounts</th><th>Saved bill figures / years</th><th>Capture method</th><th>Factual review</th><th>Retrieval status</th></tr></thead><tbody>
 {visible.map((r,i)=><tr key={`${r.kind}:${r.id}:${i}`}><th scope="row"><a href={r.href}>{r.address}</a><small> · {r.city} · {r.kind}</small></th>
 <td style={{whiteSpace:'normal'}}>{r.parcels.map(p=>`${p.county}, ${p.state}: ${p.accountId}`).join('; ')||'Parcel set unresolved'}</td>
 <td>{r.s?`${r.bills.length} saved account figures · ${r.years.length?r.years.join(', '):'dated bill window unverified'}`:'Not researched'}</td>
 <td><a href={r.href}>See unattended / assisted evidence</a></td><td>Original-record and parcel review required{r.gaps?` · ${r.gaps} authority/supplement gaps`:''}</td>
 <td>{r.job?.status??'Not queued'}{r.job?.outcome?.error&&<p>{r.job.outcome.error}</p>}<TaxCoverageActions kind={r.kind} id={r.id}/></td></tr>)}
 </tbody></table></div>}
 {!showAll?<p style={{textAlign:'center',margin:'12px 0 0'}}><Link href={href({all:'1'})} className="tchip">Show all {filtered.length}</Link></p>:null}
 </section>
 <section className="panel"><h2>Jurisdiction source onboarding</h2><p>Official sources, public interfaces, original-record reconciliation and adapter configuration must be verified before a jurisdiction is supported. Directory failures and access challenges remain open outcomes.</p>
 {jurisdictions.data?.map(j=><details key={j.jurisdiction}><summary>{j.jurisdiction} · {j.status}</summary><p>{j.review_note}</p><p>Investigated {j.updated_at}</p>{j.discovery.officialLinks?.map((l:any,i:number)=><p key={i}><a href={l.url} target="_blank" rel="noreferrer">{l.label||l.url}</a></p>)}<ol>{j.discovery.nextSteps?.map((s:string,i:number)=><li key={i}>{s}</li>)}</ol></details>)}
 </section></>}</main></>;
}
