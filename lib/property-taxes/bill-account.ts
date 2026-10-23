import type {TaxParcel,TaxRecord} from './types';
/** Collector identifiers can differ from assessor identifiers (notably Travis). */
export function billAccountMatches(parcel:TaxParcel,row:TaxRecord){
 if(!row.billEvidence)return true; // Existing issued records predate structured bill metadata.
 const account=row.billEvidence.collectorAccount;if(!account)return false;
 let expected=parcel.accountId;
 if(parcel.state==='TX'&&/^travis(?: county)?$/i.test(parcel.county)){
  const geographic=parcel.assessmentGroup.replace(/\D/g,'');
  if(!/^\d{10}(?:\d{4})?$/.test(geographic))return false;
  expected=geographic.length===10?geographic+'0000':geographic;
 }
 return account.replace(/\s/g,'').toUpperCase()===expected.replace(/\s/g,'').toUpperCase();
}
