import type {TaxState} from '@/lib/property-taxes/types';
import {historyCoverage} from '@/lib/property-taxes/coverage';
export default function TaxResearchResult({state}:{state:TaxState}){
 const coverage=historyCoverage(state);
 return <section className="panel" aria-label="Research completion"><h2>{coverage.title}</h2>
  <p><strong>{coverage.retrieved} of {coverage.expected||5} annual account bills saved</strong>{coverage.accounts.length?` across ${coverage.accounts.length} candidate account${coverage.accounts.length===1?'':'s'}`:'. Subject parcel identification is still required.'}.</p>
  <p className="hint">Evidence window: {coverage.years.at(-1)}–{coverage.latest}, ending with the latest supported bill year. Later years are not classified as unissued without county evidence. Saved history can include assisted captures and earlier runs; it does not establish successful unattended retrieval.</p>
  {state.research&&<p className="hint">Run ended {state.research.at}. Finishing a source check does not mean missing bills were found. Amounts from earlier runs remain visible when a refresh fails.</p>}
  {coverage.accounts.map(({parcel,retrieved,missing})=>{
   const attempt=state.research?.attempts?.find(a=>a.parcelKey===parcel.key);
   return <article key={parcel.key}><h3>{parcel.accountId} · {parcel.county}, {parcel.state}</h3>
    <p>{retrieved.length}/5 years saved{missing.length?` · Missing: ${missing.join(', ')}`:' · All five displayed years have sourced bill evidence'}.</p>
    {attempt&&<p>{attempt.message}{attempt.sourceUrl&&<> <a href={attempt.sourceUrl} target="_blank" rel="noreferrer">Open official source</a></>}</p>}
    {missing.length>0&&<p className="hint">Retry official sources after a temporary failure. If interactive access or an unsupported county prevents retrieval, obtain the missing dated bills from the official source and attach them for review. Hopper cannot call this history complete until those years have bill evidence.</p>}
   </article>;
  })}
  {coverage.historyComplete&&<p className="hint">This confirms the displayed accounts and years only. Verify acquisition boundaries, separately billed authorities, temporary bills and parcel matches before relying on a combined property total.</p>}
  <p className="hint">Capture provenance: {coverage.unattended} annual records from unattended retrieval; {coverage.assisted} from assisted imports. {coverage.datedWindow?'The year window is anchored to dated bill evidence.':'No dated bill establishes an available historical window; displayed years are research targets only.'} Property completeness remains unverified until the acquisition parcel set and every taxing authority are reconciled.</p>
  {state.research?.discovery?.map(d=><article key={d.jurisdiction}><h3>{d.jurisdiction} — source investigation</h3><p>{d.status.replace(/_/g,' ')}{d.adapter?` · ${d.adapter}`:''} · {d.at}</p>{d.officialLinks.map((l,i)=><p key={i}><a href={l.url} target="_blank" rel="noreferrer">{l.label||'Official directory link'}</a></p>)}<ol>{d.nextSteps.map((step,i)=><li key={i}>{step}</li>)}</ol></article>)}
 </section>;
}
