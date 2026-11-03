import type {TaxParcel,TaxRecord} from './types';
import {normalizedAccount} from './accounts';
/** Collector identifiers can differ from assessor identifiers (notably Travis). */
export function expectedCollectorAccount(parcel:TaxParcel):string|null{
 let expected=parcel.accountId;
 if(parcel.state==='TX'&&/^bexar(?: county)?$/i.test(parcel.county)){expected=parcel.assessmentGroup;if(!/^\d{12}$/.test(normalizedAccount(expected)))return null;}
 if(parcel.state==='TX'&&/^montgomery(?: county)?$/i.test(parcel.county)){expected=parcel.assessmentGroup;if(!/^\d{11}$/.test(normalizedAccount(expected)))return null;}
 if(parcel.state==='TX'&&/^travis(?: county)?$/i.test(parcel.county)){
  const geographic=parcel.assessmentGroup.replace(/\D/g,'');
  if(!/^\d{10}(?:\d{4})?$/.test(geographic))return null;
  expected=geographic.length===10?geographic+'0000':geographic;
 }
 return normalizedAccount(expected);
}
export function billAccountMatches(parcel:TaxParcel,row:TaxRecord){
 if(!row.billEvidence)return true; // Existing issued records predate structured bill metadata.
 const account=row.billEvidence.collectorAccount;if(!account)return false;
 const expected=expectedCollectorAccount(parcel);
 return expected!==null&&normalizedAccount(account)===expected;
}
