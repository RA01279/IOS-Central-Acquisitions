import {CollectorSession,htmlText,tableRows,collectorAmount} from './collector-http';
import {actAccount,actSitus,actPdfCells,parseActRecord,MONTGOMERY_ACT} from './act';
import {normalizedAddress} from './address';
import type {TaxParcel,TaxSource,TaxRecord,RetainTaxEvidence} from './types';
export function parseModernPaymentTable(table:string,latest:number){
 const clean=table.replace(/<!--[\s\S]*?-->/g,'').replace(/<tr\b[^>]*data-if=["']false["'][^>]*>[\s\S]*?<\/tr>/gi,''),head=clean.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1],body=clean.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1],totals=new Map<number,number>();
 if(!head||!body||tableRows(head)[0]?.slice(0,4).join('|')!=='Receipt Date|Amount|Tax Year|Description')throw Error('Modern ACT payment headings changed.');
 for(const row of tableRows(body).filter(r=>r.some(Boolean))){if(row.length<4)throw Error('Modern ACT payment row is incomplete.');const year=Number(row[2]),amount=collectorAmount(row[1]);if(!/^\d{4}-\d{2}-\d{2}$/.test(row[0])||!Number.isInteger(year)||year<1900||year>latest||amount===null||row[3]!=='Payment')throw Error('Modern ACT payment/refund ledger requires assisted review.');totals.set(year,(totals.get(year)??0)+Math.round(amount*100));}
 return totals;
}
export async function researchModernAct(parcel:TaxParcel,fetcher:typeof fetch=fetch,retain?:RetainTaxEvidence){
 const {base}=MONTGOMERY_ACT,account=actAccount(parcel),session=new CollectorSession(fetcher),sources:TaxSource[]=[],records:TaxRecord[]=[];
 await session.read(base+'index.jsp');const accountUrl=base+'account-details.jsp?'+new URLSearchParams({can:account}),identity=await session.read(accountUrl,{referer:base+'index.jsp'});
 const id=htmlText(identity.text).match(/Account Number:\s*(\d+)/)?.[1],situs=identity.text.match(/Property Site Address:<\/div>\s*<p[^>]*>([\s\S]*?)<\/p>/i)?.[1];
 if(id!==account||!situs||normalizedAddress(htmlText(situs))!==actSitus(parcel))throw Error('Modern ACT account/situs does not match the candidate.');
 const path=identity.text.match(/createReport\('([^']*statements\/current-statements\.jsp)'\)/)?.[1];if(!path)throw Error('Modern ACT account does not publish its current statement generator.');
 const generated=await session.read(new URL(path,accountUrl).href,{referer:accountUrl,form:new URLSearchParams({can:account,ownerno:'0'})});let report;try{report=JSON.parse(generated.text);}catch{throw Error('Modern ACT statement generation did not return a published report link.');}
 const url=new URL(report.url,base);if(url.origin!==new URL(base).origin||!/^\/dev60temp\/[^/]+\.pdf$/.test(url.pathname))throw Error('Modern ACT report is outside the approved original-record path.');
 const pdf=await session.read(url.href,{binary:true,referer:accountUrl});if(new TextDecoder().decode(pdf.bytes.slice(0,5))!=='%PDF-')throw Error('Modern ACT response is not an original PDF.');
 const cells=await actPdfCells(pdf.bytes),source:TaxSource={id:crypto.randomUUID(),label:'Montgomery modern ACT original issued statement',url:accountUrl,retrievedAt:new Date().toISOString(),taxYear:null,kind:'official',evidence:JSON.stringify({account,accountUrl,originalUrl:url.href,cells})};
 if(retain)await retain(source,pdf.bytes,'application/pdf');sources.push(source);const current=parseActRecord(cells,parcel,source);source.taxYear=current.year;records.push(current);
 const gaps:string[]=[];
 try{const paymentPath=identity.text.match(/href="([^" ]*reports\/payment-info\.jsp[^" ]*)"/)?.[1];
 if(paymentPath){const payment=await session.read(new URL(paymentPath.replace(/&amp;/g,'&'),accountUrl).href,{referer:accountUrl});const table=payment.text.match(/<table[^>]*id="payment-history"[^>]*>([\s\S]*?)<\/table>/i)?.[1];if(table){const totals=parseModernPaymentTable(table,current.year);
 const history:TaxSource={id:crypto.randomUUID(),label:'Montgomery posted payment ledger — not historical bills or net balance',url:payment.url,retrievedAt:new Date().toISOString(),taxYear:null,taxYears:[...totals.keys()].sort((a,b)=>b-a).slice(0,10),kind:'official',evidence:JSON.stringify({account,meaning:'Sum of explicitly posted Payment rows; no levy or paid-in-full inference',table})};if(retain)await retain(history,new TextEncoder().encode(JSON.stringify({account,url:payment.url,html:payment.text})),'application/json');sources.push(history);
 for(const [year,cents] of [...totals].sort((a,b)=>b[0]-a[0]).slice(0,10)){let row=records.find(r=>r.year===year);if(!row){row={parcelKey:parcel.key,year,facts:{},jurisdictions:[]};records.push(row);}row.facts.paid={value:cents/100,sourceId:history.id,stage:'reported',reviewed:false};}
 }}else gaps.push('No published payment ledger link.');}catch(e){gaps.push(e instanceof Error?e.message:String(e));}
 return {sources,records,message:`Current issued statement and ${records.filter(r=>r.facts.paid).length} years of posted payments retrieved. Older issued bills remain unresolved: the published composite receipt defaults to the current year; payment totals and Base Tax Due were not substituted for historical levies. Further public-interface onboarding or assisted original capture is required. ${gaps.join(' ')}`};
}
