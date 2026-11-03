'use client';
import {useState} from 'react';
import type {TaxState} from '@/lib/property-taxes/types';
import {parcelScopeBasis,parcelScopeVerified} from '@/lib/property-taxes/parcel-scope';
export default function TaxScopeReview({state,onChange}:{state:TaxState;onChange:(s:TaxState)=>void}){
 const [note,setNote]=useState(state.scopeReview?.note??''),[proof,setProof]=useState<string[]>(state.scopeReview?.sourceIds??[]),[error,setError]=useState('');
 function review(){
  const next={...state,scopeReview:{at:new Date().toISOString(),note,sourceIds:proof,parcelKeys:state.parcels.filter(p=>p.review!=='excluded').map(p=>p.key),basis:parcelScopeBasis(state)}};
  if(!parcelScopeVerified(next)){setError('Explain the acquisition boundary, select retained original evidence, and resolve every parcel candidate and its account coverage first.');return;}
  onChange(next);setError('');
 }
 return <section className="panel"><h2>Property parcel-set verification</h2>
  <p>Confirm the acquisition boundary and every subject account against retained original records. A point lookup and one matching street address do not establish an exhaustive parcel set. Review every taxing authority, separate collector, revision and supplement independently in the annual records.</p>
  <label>Boundary and parcel-set evidence explanation<textarea value={note} onChange={e=>setNote(e.target.value)}/></label>
  <fieldset><legend>Supporting retained records</legend>{state.sources.filter(s=>s.storagePath).map(s=><label key={s.id} style={{display:'block'}}><input type="checkbox" checked={proof.includes(s.id)} onChange={e=>setProof(e.target.checked?[...proof,s.id]:proof.filter(id=>id!==s.id))}/>{s.label}</label>)}</fieldset>
  <button type="button" onClick={review}>Record verified parcel set</button>
  {state.scopeReview&&<p>{parcelScopeVerified(state)?'Parcel-set review agrees with the current account identities.':'Parcel-set review is incomplete or stale; verify the retained originals again.'} Save the workspace to retain this review. This does not certify annual authority coverage.</p>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
