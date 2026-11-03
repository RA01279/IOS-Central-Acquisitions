import Nav from '@/components/Nav';
import {getCurrentUser} from '@/lib/auth';
import {getServiceClient} from '@/lib/supabase';
import {redirect} from 'next/navigation';
import TaxCoverageActions from '@/components/property-taxes/TaxCoverageActions';
export const dynamic='force-dynamic';
export default async function TaxCoveragePage(){
 if(!await getCurrentUser())redirect('/login');const db=getServiceClient();
 const [subjects,jobs,jurisdictions,deals,assets]=await Promise.all([
  // Never fetch every original's extraction text for an inventory summary.
  db.from('property_tax_subjects').select('subject_kind,subject_id,parcels:state->parcels,records:state->records,updated_at').limit(1000),
  db.from('property_tax_jobs').select('*').limit(1000),db.from('property_tax_jurisdictions').select('*').order('jurisdiction').limit(500),
  db.from('deals').select('id,property_id,stage,properties(address,city)').neq('stage','archived').limit(1000),db.from('assets').select('id,address,city,status').neq('status','sold').limit(1000)
 ]);const error=[subjects,jobs,jurisdictions,deals,assets].find(r=>r.error)?.error;
 const rows=[...(deals.data??[]).map((d:any)=>({kind:'property',id:d.property_id,address:d.properties?.address??'Address unresolved',city:d.properties?.city,href:`/deals/${d.id}/property-taxes`})),...(assets.data??[]).map(a=>({kind:'asset',id:a.id,address:a.address,city:a.city,href:`/property-taxes/asset/${a.id}`}))];
 return <><Nav/><main style={{maxWidth:1400,margin:'32px auto',padding:'0 24px'}}>
 <h1>Property tax coverage</h1><p>Current deals and owned assets. Saved account figures, factual review and automation are separate measures. Open a property for source-validated coverage and capture provenance.</p>
 {error?<p role="alert">Coverage storage unavailable: {error.message}</p>:<>
 <div className="table-scroll"><table className="summary-table"><thead><tr><th>Property</th><th>Jurisdictions / accounts</th><th>Saved bill figures / years</th><th>Capture method</th><th>Factual review</th><th>Retrieval status</th></tr></thead><tbody>
 {rows.map((r,i)=>{const s:any=subjects.data?.find(s=>s.subject_kind===r.kind&&s.subject_id===r.id),job=jobs.data?.find(j=>j.subject_kind===r.kind&&j.subject_id===r.id),parcels:any[]=s?.parcels??[],records:any[]=s?.records??[],bills=records.filter(x=>typeof x.facts?.levied?.value==='number'),years=[...new Set(bills.map(x=>x.year))].sort((a,b)=>b-a),gaps=bills.filter(x=>x.billEvidence?.obligationStatus!=='reconciled').length;
 return <tr key={`${r.kind}:${r.id}:${i}`}><th scope="row"><a href={r.href}>{r.address}</a><small> · {r.city} · {r.kind}</small></th>
 <td>{parcels.map(p=>`${p.county}, ${p.state}: ${p.accountId}`).join('; ')||'Parcel set unresolved'}</td>
 <td>{s?`${bills.length} saved account figures · ${years.length?years.join(', '):'dated bill window unverified'}`:'Not researched'}</td>
 <td><a href={r.href}>See unattended / assisted evidence</a></td><td>Original-record and parcel review required{gaps?` · ${gaps} authority/supplement gaps`:''}</td>
 <td>{job?.status??'Not queued'}{job?.outcome?.error&&<p>{job.outcome.error}</p>}<TaxCoverageActions kind={r.kind} id={r.id}/></td></tr>;})}
 </tbody></table></div>
 <section className="panel"><h2>Jurisdiction source onboarding</h2><p>Official sources, public interfaces, original-record reconciliation and adapter configuration must be verified before a jurisdiction is supported. Directory failures and access challenges remain open outcomes.</p>
 {jurisdictions.data?.map(j=><details key={j.jurisdiction}><summary>{j.jurisdiction} · {j.status}</summary><p>{j.review_note}</p><p>Investigated {j.updated_at}</p>{j.discovery.officialLinks?.map((l:any,i:number)=><p key={i}><a href={l.url} target="_blank" rel="noreferrer">{l.label||l.url}</a></p>)}<ol>{j.discovery.nextSteps?.map((s:string,i:number)=><li key={i}>{s}</li>)}</ol></details>)}
 </section></>}</main></>;
}
