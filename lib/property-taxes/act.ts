// ACT portal family with individually verified county configurations.
import {CollectorSession,collectorAmount,htmlText} from './collector-http';
import {normalizedAddress} from './address';
import {normalizedAccount} from './accounts';
import type {PdfCell} from './travis';
import type {TaxParcel,TaxSource,TaxRecord,RetainTaxEvidence} from './types';
export const DALLAS_ACT={base:'https://www.dallasact.com/act_webdev/dallas/',name:'Dallas County',accountPattern:/^[A-Z0-9]{17}$/};
export const BEXAR_ACT={base:'https://bexar.acttax.com/act_webdev/bexar/',name:'Bexar County',accountPattern:/^\d{12}$/};
export const MONTGOMERY_ACT={base:'https://actweb.acttax.com/montgomery/montgomery/',name:'Montgomery County',accountPattern:/^\d{11}$/};
function actConfig(parcel:TaxParcel){if(parcel.state!=='TX')throw Error('ACT county configuration is unverified.');if(/^bexar(?: county)?$/i.test(parcel.county))return BEXAR_ACT;if(/^dallas(?: county)?$/i.test(parcel.county))return DALLAS_ACT;if(/^montgomery(?: county)?$/i.test(parcel.county))return MONTGOMERY_ACT;throw Error('ACT county configuration is unverified.');}
export function actAccount(parcel:TaxParcel){const config=actConfig(parcel),account=normalizedAccount(config===DALLAS_ACT?parcel.accountId:parcel.assessmentGroup);if(!config.accountPattern.test(account))throw Error(`${config.name} collector account format requires review; no padding or truncation was guessed.`);return account;}
export function actSitus(parcel:TaxParcel){const config=actConfig(parcel);return normalizedAddress(config===BEXAR_ACT?parcel.address.replace(/\s+SAN ANTONIO(?=,|$)/i,''):config===MONTGOMERY_ACT?parcel.address.replace(/\s+CONROE(?=,|$)/i,''):parcel.address);}
function unique(cells:PdfCell[],test:(c:PdfCell)=>boolean,label:string){const found=cells.filter(test);if(found.length!==1)throw Error(`ACT ${label} is missing or ambiguous; original record needs review.`);return found[0];}
function number(cell:PdfCell){const n=collectorAmount(cell.text.replace(/^\./,'0.'));if(n===null)throw Error('ACT numeric column is unknown; no zero substituted.');return n;}
export function parseActRecord(cells:PdfCell[],parcel:TaxParcel,source:TaxSource,year?:number):TaxRecord{
 const account=actAccount(parcel),text=cells.map(c=>c.text).join(' '),receipt=year!==undefined;
 const situsLabel=cells.find(c=>c.text==='Parcel Address:');
 const situs=situsLabel?cells.filter(c=>c.x>situsLabel.x+65&&Math.abs(c.y-situsLabel.y)<2).sort((a,b)=>a.x-b.x).map(c=>c.text).join(' '):undefined;
 if(!cells.some(c=>c.text.replace(/[\s-]/g,'')===account)||!(situs?normalizedAddress(situs)===actSitus(parcel):cells.some(c=>normalizedAddress(c.text)===actSitus(parcel))))throw Error('ACT record account or situs does not match the candidate parcel.');
 if(receipt){
  if(!cells.some(c=>/^PAYMENT RECORD(?: VIA WEB)?$/.test(c.text))||!cells.some(c=>c.text==='Levy Total :'))throw Error('ACT record does not explicitly publish a levy total.');
  const heading=unique(cells,c=>c.text==='Year :','year heading');
  if(unique(cells,c=>c.x>heading.x+40&&c.x<heading.x+100&&Math.abs(c.y-heading.y)<3,'printed year').text!==String(year))throw Error('ACT requested year differs from printed year.');
 }else {const config=actConfig(parcel),years=[...text.matchAll(config===BEXAR_ACT?/\b(20\d{2}) REAL PROPERTY\b/g:config===MONTGOMERY_ACT?/\b(20\d{2}) YEAR TAX STATEMENT\b/g:/\b(20\d{2}) TAX STATEMENT\b/g)];if(years.length!==1)throw Error('ACT issued statement year is ambiguous.');year=Number(years[0][1]);}
 if(!year||year>new Date().getFullYear()||year<1900)throw Error('ACT tax year is invalid.');
 const config=actConfig(parcel),heading=unique(cells,c=>c.text===(receipt?'Tax Unit Name':config===BEXAR_ACT?'TAXING UNIT':config===MONTGOMERY_ACT?'Taxing':'Jurisdiction'),'authority heading');
 const bottom=receipt?unique(cells,c=>c.text==='Levy Total :','levy boundary').y:config===BEXAR_ACT?unique(cells,c=>c.text===`TAXES FOR ${year}:`,'statement total boundary').y:config===MONTGOMERY_ACT?unique(cells,c=>c.text===`Total ${year} Tax:`,'statement total boundary').y:heading.y-180;
 const names=cells.filter(c=>c.x>=(receipt?50:15)&&c.x<(receipt?200:300)&&c.y<heading.y-4&&c.y>bottom+2&&/^[A-Z][A-Z .&/-]+$/.test(c.text));
 if(!names.length||new Set(names.map(c=>c.text)).size!==names.length)throw Error('ACT authority rows are missing or duplicated; supplemental/revised obligations require review.');
 const parts=names.map(name=>{
  const at=(min:number,max:number,label:string)=>unique(cells,c=>c.x>=min&&c.x<max&&Math.abs(c.y-name.y)<1.2,label);
  if(receipt&&at(25,50,'authority year').text!==String(year))throw Error('ACT authority tax years differ.');
  return {name:name.text,taxable:number(at(receipt?200:400,receipt?255:480,'taxable value')),rate:number(at(receipt?260:480,receipt?315:540,'tax rate')),levy:number(at(receipt?320:540,receipt?380:610,'levy'))};
 });
 const sum=Math.round(parts.reduce((n,p)=>n+p.levy,0)*100)/100;
 if(receipt){const total=unique(cells,c=>c.text==='Levy Total :','levy total');const amount=number(unique(cells,c=>c.x>320&&c.x<380&&Math.abs(c.y-total.y)<1.2,'levy total amount'));if(Math.abs(sum-amount)>.011)throw Error('ACT authority levies do not reconcile to the published Levy Total.');}
 else {const amounts=cells.filter(c=>/^\$[\d,]+\.\d{2}$/.test(c.text));if(!amounts.some(c=>Math.abs(number(c)-sum)<.011))throw Error('ACT statement charges do not reconcile to a printed total.');}
 return {parcelKey:parcel.key,year,facts:{levied:{value:sum,sourceId:source.id,stage:receipt?'reported':'issued',reviewed:false}},jurisdictions:parts.map(p=>({name:p.name,rate:p.rate,unit:'per_100',taxable:p.taxable,exemption:null,levied:p.levy,sourceId:source.id,stage:'adopted'})),billEvidence:{kind:receipt?'collector_history':'issued_statement',sourceId:source.id,collectorAccount:account,scope:'Only the named authorities collected on this ACT record. Separate school/city collectors and acquisition parcels remain unverified.',notes:receipt?'Published Levy column reconciled to Levy Total in original yearly payment record. Payments, refunds, fees and balances are not used as levies. May reflect revised levies.':'Issued current statement; authority charges reconciled. Not the summary balance statement.',obligationStatus:'partial'}};
}
export async function actPdfCells(bytes:Uint8Array){const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const d=await getDocument({data:bytes.slice(),isEvalSupported:false,useSystemFonts:true}).promise;try{if(d.numPages>5)throw Error('ACT PDF exceeds supported layout.');const c=await(await d.getPage(1)).getTextContent();return c.items.filter(i=>'str'in i&&i.str.trim()).map(i=>({text:'str'in i?i.str.trim():'',x:'transform'in i?i.transform[4]:0,y:'transform'in i?i.transform[5]:0}));}finally{await d.destroy();}}
function publishedLink(html:string,base:string,pattern:RegExp){const links=[...html.matchAll(/href=['"]([^'"]+)['"]/gi)].map(m=>new URL(m[1].replace(/&amp;/g,'&'),base).href).filter(u=>pattern.test(u));if(links.length!==1)throw Error('ACT published record link is missing or ambiguous.');return links[0];}
export async function researchActHistory(parcel:TaxParcel,fetcher:typeof fetch=fetch,retain?:RetainTaxEvidence){
 const config=actConfig(parcel),{base}=config,account=actAccount(parcel),session=new CollectorSession(fetcher),sources:TaxSource[]=[],records:TaxRecord[]=[],gaps:string[]=[];
 await session.read(base+'index.jsp');
 const accountUrl=base+'showdetail2.jsp?'+new URLSearchParams({can:account}),identity=await session.read(accountUrl,{referer:base+'index.jsp'});
 const id=htmlText(identity.text).match(/Account Number:\s*([A-Z0-9]+)/i)?.[1],situs=identity.text.match(/Property Site Address:<\/(?:b|label)>\s*<br\s*\/?\s*>\s*([^<]+)/i)?.[1];
 if(id!==account||!situs||normalizedAddress(htmlText(situs))!==actSitus(parcel))throw Error('ACT collector account/address differs from the candidate parcel.');
 async function original(start:string,year?:number,form?:URLSearchParams){
  const prepare=await session.read(start,{form,referer:accountUrl});
  const refresh=prepare.text.match(/CONTENT="([1-3]);URL=([^"]+)"/i);if(!refresh)throw Error('ACT statement generation did not publish its download step.');
  await new Promise(r=>setTimeout(r,Number(refresh[1])*1000));
  const download=await session.read(new URL(refresh[2],start).href,{referer:start}),url=publishedLink(download.text,download.url,/^https:\/\/(?:www\.dallasact\.com|bexar\.acttax\.com)\/dev60temp\/[^/]+\.pdf$/i);if(new URL(url).origin!==new URL(base).origin)throw Error('ACT original moved outside the configured official county host.');
  const response=await session.read(url,{binary:true,referer:download.url});if(new TextDecoder().decode(response.bytes.slice(0,5))!=='%PDF-')throw Error('ACT did not return an original PDF.');
  const cells=await actPdfCells(response.bytes),source:TaxSource={id:crypto.randomUUID(),label:`${config.name} ACT ${year??'current'} original ${year?'yearly levy record':'issued statement'}`,url:year?start:accountUrl,retrievedAt:new Date().toISOString(),taxYear:null,kind:'official',evidence:JSON.stringify({account,accountUrl,originalUrl:url,requestYear:year,identity:htmlText(identity.text).slice(0,4000),cells}).slice(0,60000)};
  // Retain even a rejected/empty original: a failed match must remain auditable.
  source.taxYear=year??null;if(retain)await retain(source,response.bytes,'application/pdf');sources.push(source);
  const row=parseActRecord(cells,parcel,source,year);source.taxYear=row.year;records.push(row);return row;
 }
 const current=publishedLink(identity.text,accountUrl,/\/requests\/currentstatement\/(?:statement_prepare|prepare)\.jsp\?/);
 let latest:number|undefined;try{latest=(await original(current)).year;}catch(e){gaps.push(`Current statement: ${e instanceof Error?e.message:String(e)}`);}
 try{
 const yearsUrl=publishedLink(identity.text,accountUrl,/\/requests\/receipt\/composite_year\.jsp\?/),yearsPage=await session.read(yearsUrl);
 const years=[...yearsPage.text.matchAll(/<option\s+value=["']?(20\d{2})["']?\s*>\s*\1\s*<\/option>/gi)].map(m=>Number(m[1])).sort((a,b)=>b-a);
 const windowSource:TaxSource={id:crypto.randomUUID(),label:`${config.name} dated public history-year selector (availability leads, not issued bills)`,url:yearsUrl,retrievedAt:new Date().toISOString(),taxYear:null,kind:'official',evidence:JSON.stringify({account,availableYearOptions:years,targetWindow:'Five latest dated years, anchored to issued current statement when available; earlier options are not proof of issued bills.',excerpt:htmlText(yearsPage.text).slice(0,20000)})};
 if(retain)await retain(windowSource,new TextEncoder().encode(JSON.stringify({account,url:yearsUrl,retrievedAt:windowSource.retrievedAt,html:yearsPage.text})),'application/json');sources.push(windowSource);
 const form=yearsPage.text.match(/<form action="([^"]+)" method="post">/i)?.[1];if(!form)throw Error('ACT yearly levy record form is unavailable.');
 const endpoint=new URL(form,yearsUrl).href;
 latest=latest??years[0];if(!latest)throw Error('No dated ACT year window is published.');
 for(const year of Array.from({length:5},(_,i)=>latest!-i).filter(y=>!records.some(r=>r.year===y))){if(!years.includes(year)){gaps.push(`${year}: no published yearly record option.`);continue;}try{await original(endpoint,year,new URLSearchParams({can:account,year:String(year)}));}catch(e){gaps.push(`${year}: ${e instanceof Error?e.message:String(e)}`);}}
 }catch(e){gaps.push(`Yearly record discovery: ${e instanceof Error?e.message:String(e)}`);}
 return {sources,records,gaps};
}
