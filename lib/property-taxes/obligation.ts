import type {TaxParcel,TaxRecord,TaxState} from './types';
import {obligationReviewProblem} from './obligation-review';
/** A sourced bill amount is not by itself proof of the whole annual obligation. */
export function obligationLimitation(parcel:TaxParcel,row:TaxRecord,state?:TaxState){
 const status=row.billEvidence?.obligationStatus;
 if(state&&row.obligationReview&&!obligationReviewProblem(state,row))return undefined;
 if(status==='temporary'||/temporary bill|under appeal/i.test(String(row.facts.appeal?.value??'')))return `${parcel.accountId}: temporary bill; final or supplemental bill not verified`;
 if(status==='partial'||(parcel.state==='TX'&&/^harris(?: county)?$/i.test(parcel.county)&&row.billEvidence?.kind==='collector_history'))return `${parcel.accountId}: collector subtotal; separately billed authorities not reconciled`;
 if(status==='unverified')return `${parcel.accountId}: annual obligation scope not reconciled`;
 return `${parcel.accountId}: annual authority and revised/supplemental bill scope is unverified${row.obligationReview?' or its review is stale':''}`;
}
