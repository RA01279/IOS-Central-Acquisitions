import type {TaxRecord, TaxSource} from './types';
import { normalizedAddress as normalizeAddress, nameKey } from './address';

export function parseGwinnettBill(raw:string, account:string, address:string, source:TaxSource, key:string):TaxRecord {
 const text=raw.replace(/\s+/g,' ').trim();
 const id=account.replace(/\s/g,'');
 if(!text.replace(/\s/g,'').includes(id) || !(` ${nameKey(text)} `).includes(` ${normalizeAddress(address)} `)) throw new Error('Bill identity does not match the subject account and address.');
 const header=text.match(/\b(20\d{2})\s+R\d{4}\s*\d{3}[A-Z]?\s+(\d{2})-(\d{2})-(20\d{2})\s+\$([\d,]+\.\d{2})/);
 if(!header || header[1]!==header[4]) throw new Error('Dated bill header could not be verified.');
 const money=(label:RegExp)=>{const m=text.match(label);if(!m)throw new Error('Required bill total is missing.');return Number(m[1].replace(/,/g,''));};
 const market=money(/TOTAL VALUE:\s*\$([\d,]+(?:\.\d{2})?)/), assessed=money(/ASSESSED VALUE:\s*\$([\d,]+(?:\.\d{2})?)/);
 const adValorem=money(/TOTAL AD VALOREM TAXES:\s*([\d,]+\.\d{2})/), special=money(/TOTAL OTHER ASSESSMENTS:\s*([\d,]+\.\d{2})/), total=money(/TOTAL AMOUNT DUE\s+([\d,]+\.\d{2})/);
 if(Math.abs(adValorem+special-total)>.011 || Math.abs(Number(header[5].replace(/,/g,''))-total)>.011) throw new Error('Bill totals do not reconcile.');
 const fact=(value:number|string)=>({value,sourceId:source.id,stage:'issued' as const,reviewed:false});
 source.taxYear=Number(header[1]);
 const rate=text.match(/TOTAL MILLAGE RATE:\s*([\d.]+)/);
 return {parcelKey:key,year:Number(header[1]),facts:{market:fact(market),assessed:fact(assessed),levied:fact(total),dueDate:fact(`${header[4]}-${header[2]}-${header[3]}`),...(/value is under appeal/i.test(text)?{appeal:fact('Official bill states property value is under appeal; temporary bill.')}:{})},jurisdictions:rate?[{name:'Combined ad valorem rate; bill also includes separately stated assessments (see source)',rate:Number(rate[1]),unit:'decimal',taxable:null,exemption:null,sourceId:source.id,stage:'adopted'}]:[]};
}

export async function gwinnettPdfText(bytes:Uint8Array) {
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const doc=await getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true}).promise;
 try {const page=await doc.getPage(1), content=await page.getTextContent();return content.items.map(i=>'str' in i?i.str:'').join(' ');}finally{await doc.destroy();}
}
