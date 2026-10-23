import type {TaxParcel,TaxRecord} from './types';
/** A sourced bill amount is not by itself proof of the whole annual obligation. */
export function obligationLimitation(parcel:TaxParcel,row:TaxRecord){
 const status=row.billEvidence?.obligationStatus;
 if(status==='temporary'||/temporary bill|under appeal/i.test(String(row.facts.appeal?.value??'')))return `${parcel.accountId}: temporary bill; final or supplemental bill not verified`;
 if(status==='partial'||(parcel.state==='TX'&&/^harris(?: county)?$/i.test(parcel.county)&&row.billEvidence?.kind==='collector_history'))return `${parcel.accountId}: collector subtotal; separately billed authorities not reconciled`;
 if(status==='unverified')return `${parcel.accountId}: annual obligation scope not reconciled`;
 return undefined;
}
