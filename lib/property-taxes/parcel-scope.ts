import type {TaxState} from './types';
export function parcelScopeBasis(state:TaxState){
 return JSON.stringify([...state.parcels].sort((a,b)=>a.key.localeCompare(b.key)).map(p=>[p.key,p.accountId,p.state,p.county,p.address,p.legal,p.assessmentGroup,p.component,p.review,p.reviewNote]));
}
export function parcelScopeVerified(state:TaxState){
 const review=state.scopeReview,parcels=state.parcels.filter(p=>p.review!=='excluded');
 return !!review&&!!review.note.trim()&&review.basis===parcelScopeBasis(state)&&review.sourceIds.length>0&&
  review.sourceIds.every(id=>state.sources.some(s=>s.id===id&&s.storagePath&&s.evidence.trim()))&&
  parcels.length>0&&parcels.every(p=>p.review==='included'&&p.component!=='unknown'&&p.reviewNote.trim())&&
  review.parcelKeys.length===parcels.length&&new Set(review.parcelKeys).size===parcels.length&&parcels.every(p=>review.parcelKeys.includes(p.key));
}
