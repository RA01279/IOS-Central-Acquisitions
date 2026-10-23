import type {TaxParcel,TaxSource,TaxRecord,Fact} from './types';
import {normalizedAddress} from './address';
import {collectorAmount} from './collector-http';

/** Parse a user capture of the ordinary county account page after interactive
 * access. This never accepts/transfers browser cookies or CAPTCHA credentials. */
export function importGwinnettHistory(raw:string,url:string,parcel:TaxParcel){
 if(raw.length>60000||parcel.state!=='GA'||parcel.county.toLowerCase().replace(/ county$/,'')!=='gwinnett')throw Error('Choose a Gwinnett account and copied official account page text.');
 const link=new URL(url),path=decodeURIComponent(link.pathname).replace(/\+/g,' ');
 if(link.origin!=='https://www.gwinnetttaxcommissioner.com'||link.username||link.password||!path.includes(`/propertyInfo/${parcel.accountId}/`))throw Error('Use the official account-details URL for this exact parcel.');
 const flat=raw.replace(/\s+/g,' '),id=flat.match(/Parcel ID\s*:\s*(R\d{4}\s*\d{3}[A-Z]?)/i)?.[1];
 const address=flat.match(/Site Address\s*:\s*(.*?)\s*Mailing Address\s*:/i)?.[1];
 if(id?.replace(/\s/g,'')!==parcel.accountId.replace(/\s/g,'')||!address||!normalizedAddress(address).startsWith(normalizedAddress(parcel.address)+' '))throw Error('Copied county account and situs address must match the selected parcel.');
 const table=raw.slice(raw.indexOf('Year\tNet Tax\tTotal Paid\tFees\tPenalty\tInterest\tDue Date\tAmount Due'));
 if(!table.startsWith('Year\t'))throw Error('Copy the full county account page including the Tax Bills table with its original columns.');
 const source:TaxSource={id:crypto.randomUUID(),label:'Gwinnett official account history · user-imported capture',url:link.origin+link.pathname,retrievedAt:new Date().toISOString(),taxYear:null,kind:'manual',captureMethod:'user_import',evidence:raw};
 const rows:TaxRecord[]=[],seen=new Set<number>();
 for(const line of table.split(/\r?\n/)){
  const cells=line.trim().split('\t');if(!/^20\d{2}$/.test(cells[0]))continue;
  const year=Number(cells[0]);if(cells.length!==8||seen.has(year)||year>new Date().getFullYear())throw Error('History year/column alignment is ambiguous; no figures imported.');seen.add(year);
  const amounts=[...cells.slice(1,6),cells[7]].map(collectorAmount);if(amounts.some(x=>x===null))throw Error('Every monetary cell must contain an explicit amount; blank cells are not zero.');
  const [levied,paid,fees,penalties,interest,balance]=amounts as number[];
  if(Math.abs(levied+fees+penalties+interest-paid-balance)>.02)throw Error(`Bill, payments and balance do not reconcile for ${year}; review the county record.`);
  const date=cells[6].match(/^(\d{2})\/(\d{2})\/(20\d{2})$/);if(!date)throw Error(`Due date is unavailable for ${year}.`);
  const iso=`${date[3]}-${date[1]}-${date[2]}`;if(new Date(iso).toISOString().slice(0,10)!==iso)throw Error('Invalid county due date.');
  const fact=(value:number|string):Fact=>({value,sourceId:source.id,stage:'reported',reviewed:false});
  rows.push({parcelKey:parcel.key,year,facts:{levied:fact(levied),paid:fact(paid),balance:fact(balance),penalties:fact(penalties),interest:fact(interest),dueDate:fact(iso)},jurisdictions:[],billEvidence:{kind:'collector_history',sourceId:source.id,collectorAccount:parcel.accountId,scope:'County collector account history; confirm separately billed authorities and acquisition parcels.',notes:'User-imported capture of the official Tax Bills table after interactive county access. Net Tax is the published bill amount; Total Paid and Amount Due are retained separately. Fees remain in the raw evidence. Not an automated server verification.'}});
 }
 const records=rows.sort((a,b)=>b.year-a.year).slice(0,5);if(!records.length)throw Error('No dated tax bill rows found.');source.taxYears=records.map(r=>r.year);
 return {source,records};
}
