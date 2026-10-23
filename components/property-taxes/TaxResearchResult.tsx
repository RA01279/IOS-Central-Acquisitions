import type {TaxState} from '@/lib/property-taxes/types';
import {historyCoverage} from '@/lib/property-taxes/coverage';
export default function TaxResearchResult({state}:{state:TaxState}){
 const coverage=historyCoverage(state);
 return <section className="panel" aria-label="Research completion"><h2>{coverage.title}</h2>
  <p><strong>{coverage.retrieved} of {coverage.expected||5} annual account bills retrieved</strong>{coverage.accounts.length?` across ${coverage.accounts.length} candidate account${coverage.accounts.length===1?'':'s'}`:'. Subject parcel identification is still required.'}.</p>
  {state.research&&<p className="hint">Run ended {state.research.at}. Finishing a source check does not mean missing bills were found. Amounts from earlier runs remain visible when a refresh fails.</p>}
  {coverage.accounts.map(({parcel,retrieved,missing})=>{
   const attempt=state.research?.attempts?.find(a=>a.parcelKey===parcel.key);
   return <article key={parcel.key}><h3>{parcel.accountId} · {parcel.county}, {parcel.state}</h3>
    <p>{retrieved.length}/5 years retrieved{missing.length?` · Missing: ${missing.join(', ')}`:' · All five displayed years have sourced bill evidence'}.</p>
    {attempt&&<p>{attempt.message}{attempt.sourceUrl&&<> <a href={attempt.sourceUrl} target="_blank" rel="noreferrer">Open official source</a></>}</p>}
    {missing.length>0&&<p className="hint">Retry official sources after a temporary failure. If interactive access or an unsupported county prevents retrieval, obtain the missing dated bills from the official source and attach them for review. Hopper cannot call this history complete until those years have bill evidence.</p>}
   </article>;
  })}
  {coverage.historyComplete&&<p className="hint">This confirms the displayed accounts and years only. Verify acquisition boundaries, separately billed authorities, temporary bills and parcel matches before relying on a combined property total.</p>}
 </section>;
}
