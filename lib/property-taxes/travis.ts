import {CollectorSession,collectorAmount} from './collector-http';
import {nameKey,normalizedAddress} from './address';
import type {TaxParcel,TaxSource,TaxRecord} from './types';
export interface PdfCell {text:string;x:number;y:number}
export function travisCollectorAccount(parcel:TaxParcel){const raw=parcel.assessmentGroup.replace(/\D/g,'');if(/^\d{14}$/.test(raw))return raw;if(/^\d{10}$/.test(raw))return raw+'0000';throw Error('No verified Travis geographic parcel ID; collector account was not guessed.');}
export function parseTravisHistory(cells:PdfCell[],firstPage:string,parcel:TaxParcel,source:TaxSource):TaxRecord[]{
 const account=travisCollectorAccount(parcel),text=firstPage.replace(/\s+/g,' ');
 if(!new RegExp(account.split('').join('[-\\s]*')).test(text))throw Error('Official bill collector account does not match the geographic parcel.');
 const wanted=normalizedAddress(parcel.address);if(!wanted||!(` ${nameKey(text)} `).includes(` ${wanted} `))throw Error('Official bill situs does not match the parcel.');
 const top=cells.find(c=>c.text==='Five Year Tax History'),bottom=cells.find(c=>c.text==='Five Year % of Change');
 if(!top||!bottom||top.y<=bottom.y)throw Error('Historical bill layout is not recognized; no years inferred.');
 const within=cells.filter(c=>c.y<top.y&&c.y>bottom.y+2),years=within.filter(c=>/^20\d{2}$/.test(c.text)&&(c.x<50||c.x>300&&c.x<350));
 if(years.length<2||years.length>6||new Set(years.map(c=>c.text)).size!==years.length)throw Error('Historical tax-year columns are ambiguous.');
 const records:TaxRecord[]=[];
 for(const year of years){
  const total=within.filter(c=>c.text==='Total'&&Math.abs(c.x-year.x)<35&&c.y<year.y-20&&c.y>year.y-150).sort((a,b)=>b.y-a.y)[0];
  if(!total)continue;
  const amounts=within.filter(c=>/^\$?[\d,]+\.\d{2}$/.test(c.text)&&Math.abs(c.y-total.y)<1.2&&c.x>year.x+120&&c.x<year.x+260);
  if(amounts.length!==1)throw Error(`Historical total is ambiguous for ${year.text}.`);
  const amount=collectorAmount(amounts[0].text);if(amount===null)continue;
  const charges=within.filter(c=>/^\$?[\d,]+\.\d{2}$/.test(c.text)&&Math.abs(c.x-amounts[0].x)<12&&c.y<=year.y+1&&c.y>total.y+2).map(c=>collectorAmount(c.text));
  if(!charges.length||charges.some(x=>x===null)||Math.abs(charges.reduce<number>((a,b)=>a+(b??0),0)-amount)>.02)throw Error(`Historical authority charges do not reconcile for ${year.text}.`);
  const actualYear=Number(year.text);if(actualYear>new Date().getFullYear())throw Error('Future bill year cannot be classified as historical.');
  records.push({parcelKey:parcel.key,year:actualYear,facts:{levied:{value:amount,sourceId:source.id,stage:'reported',reviewed:false}},jurisdictions:[],billEvidence:{kind:'collector_history',sourceId:source.id,collectorAccount:account,scope:'Travis County collector bill history; verify whether all acquisition parcels and separately billed authorities are covered.',notes:'Tax Imposed / Total from the official bill Five Year Tax History. PDF columns and jurisdiction-charge sums verified. Historical bills are not current balances or proof of payment.'}});
 }
 return records.sort((a,b)=>b.year-a.year).slice(0,5);
}
export async function researchTravisHistory(parcel:TaxParcel,fetcher:typeof fetch=fetch){
 const account=travisCollectorAccount(parcel),url='https://travis.go2gov.net/export?'+new URLSearchParams({account,type:'org'});
 const response=await new CollectorSession(fetcher).read(url,{binary:true});if(new TextDecoder().decode(response.bytes.slice(0,5))!=='%PDF-')throw Error('Official collector did not return a bill PDF; interactive access may be required.');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),doc=await getDocument({data:response.bytes,isEvalSupported:false,useSystemFonts:true}).promise;
 try{
  if(doc.numPages<2||doc.numPages>5)throw Error('Official bill page count is outside the supported format.');
  const first=await(await doc.getPage(1)).getTextContent(),firstPage=first.items.map(i=>'str'in i?i.str:'').join(' ');
  const second=await(await doc.getPage(2)).getTextContent(),cells:PdfCell[]=second.items.filter(i=>'str'in i).map(i=>({text:'str'in i?i.str.trim():'',x:'transform'in i?i.transform[4]:0,y:'transform'in i?i.transform[5]:0}));
  const source:TaxSource={id:crypto.randomUUID(),label:'Travis County official bill · five-year historical tax charges',url,retrievedAt:new Date().toISOString(),taxYear:null,kind:'official',evidence:JSON.stringify({collectorAccount:account,firstPage,historyCells:cells}).slice(0,60000)};
  const records=parseTravisHistory(cells,firstPage,parcel,source);if(!records.length)throw Error('Official bill contains no verified historical totals.');
  source.taxYears=records.map(r=>r.year);
  return {source,records};
 }finally{await doc.destroy();}
}
