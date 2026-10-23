import {CollectorSession,collectorAmount,htmlText,tableRows} from './collector-http';
import {normalizedAddress} from './address';
import type {TaxRecord,TaxParcel,TaxSource,Fact} from './types';
export const HARRIS_SEARCH='https://www.hctax.net/Property/ViewStatementReceipts';
const BASE='https://www.hctax.net/Property/';
export function parseHarrisHistory(html:string,statement:string,parcel:TaxParcel,source:TaxSource):TaxRecord[]{
 const account=parcel.accountId.replace(/\D/g,'');if(!/^\d{13}$/.test(account))throw Error('Harris collector account must have 13 digits.');
 const identity=statement.match(/class="Subtitle-Account"[^>]*>([\s\S]*?)<\/td>/i);
 if(!identity||htmlText(identity[1]).replace(/\D/g,'')!==account||!new RegExp(`Account Number:\\s*${account}\\b`,'i').test(htmlText(html)))throw Error('Collector account does not match the parcel.');
 const situs=statement.match(/Property Description<\/td>[\s\S]*?<\/tr>\s*<tr>\s*<td[^>]*>([\s\S]*?)<br\s*\/?\s*>/i)?.[1];
 const address=htmlText(situs??'').replace(/\s+\d{5}(?:-\d{4})?$/,'');
 if(!address||normalizedAddress(address)!==normalizedAddress(parcel.address))throw Error('Collector situs address differs from the candidate parcel; review the account before importing bills.');
 const rows=tableRows(html),yearsRow=rows.find(r=>r[0]==='Years');
 if(!yearsRow||yearsRow.length<2)throw Error('No dated collector bill history.');
 const years=yearsRow.slice(1).map(Number);if(years.some(y=>!Number.isInteger(y)||y<1900||y>new Date().getFullYear())||new Set(years).size!==years.length)throw Error('Collector history years could not be verified.');
 const totals=rows.find(r=>r[0]==='Total Tax Bill by Year');if(!totals||totals.length!==years.length+1)throw Error('No complete original tax-bill totals row.');
 const jurisdictions:[string,string[],string[],string[]][]=[];
 for(const table of html.matchAll(/<table\b[^>]*class="value"[^>]*>([\s\S]*?)<\/table>/gi)){
  const rs=tableRows(table[1]),name=rs[0]?.[0],values=rs.find(r=>r[0]==='Tax Value'),rates=rs.find(r=>r[0]==='Tax Rate'),bills=rs.find(r=>r[0]==='Tax Bill');
  if(name&&values&&rates&&bills){if([values,rates,bills].some(r=>r.length!==years.length+1))throw Error('Jurisdiction history columns do not align.');jurisdictions.push([name,values.slice(1),rates.slice(1),bills.slice(1)]);}
 }
 if(!jurisdictions.length)throw Error('No collector jurisdiction bill breakdown to reconcile.');
 const result:TaxRecord[]=[];
 for(let i=0;i<years.length;i++){
  const amount=collectorAmount(totals[i+1]);if(amount===null)continue; // blank is unknown, never zero
  const parts=jurisdictions.map(([name,values,rates,bills])=>({name,taxable:collectorAmount(values[i]),rate:collectorAmount(rates[i]),bill:collectorAmount(bills[i])}));
  if(parts.some(p=>p.bill===null)||Math.abs(parts.reduce((sum,p)=>sum+p.bill!,0)-amount)>.02)throw Error(`Collector bill total does not reconcile for ${years[i]}.`);
  const fact=(value:number|string):Fact=>({value,sourceId:source.id,stage:'reported',reviewed:false});
  result.push({parcelKey:parcel.key,year:years[i],facts:{levied:fact(amount)},jurisdictions:parts.filter(p=>p.rate!==null).map(p=>({name:p.name,rate:p.rate!,unit:'per_100',taxable:p.taxable,exemption:null,sourceId:source.id,stage:'adopted'})),billEvidence:{kind:'collector_history',sourceId:source.id,collectorAccount:account,scope:'Collector bill total only; separately billed school districts, cities or other authorities may be additional.',notes:'Official collector Total Tax Bill by Year; jurisdiction charges reconciled. This is the published bill history, not remaining balances, payments or a forecast.'}});
 }
 return result.sort((a,b)=>b.year-a.year).slice(0,5);
}
export async function researchHarrisHistory(parcel:TaxParcel,fetcher:typeof fetch=fetch){
 const account=parcel.accountId.replace(/\D/g,'');if(!/^\d{13}$/.test(account))throw Error('Invalid Harris collector account; no account guessed.');
 const session=new CollectorSession(fetcher);await session.read(HARRIS_SEARCH);
 const token=(await session.read(BASE+'AccountEncrypt?'+new URLSearchParams({account}))).text.trim();if(!token||token.length>500||/<|>/.test(token))throw Error('Collector did not resolve the public account.');
 const statementUrl=BASE+'TaxStatement?'+new URLSearchParams({account:token}),statement=await session.read(statementUrl);
 // Follow the public account page's own history link, within its ordinary session.
 const published=statement.text.match(/\.load\('HistoryTab\?Account=(\d{13})'\)/);if(published?.[1]!==account)throw Error('Official account page does not publish a history lookup for this account.');
 const history=await session.read(BASE+'HistoryTab?'+new URLSearchParams({Account:account}),{referer:statementUrl,ajax:true});
 const identity=statement.text.slice(statement.text.indexOf('<div id="CurrentStatement">'));
 const source:TaxSource={id:crypto.randomUUID(),label:'Harris County Tax Office · historical tax bills (collector scope)',url:statementUrl,retrievedAt:new Date().toISOString(),taxYear:null,kind:'official',evidence:JSON.stringify({account,matchedParcelAddress:parcel.address,statementIdentity:htmlText(identity).slice(0,1500),history:history.text}).slice(0,60000)};
 const records=parseHarrisHistory(history.text,statement.text,parcel,source);if(!records.length)throw Error('No dated billed amounts were published for this account.');
 source.taxYears=records.map(r=>r.year);
 return {source,records};
}
