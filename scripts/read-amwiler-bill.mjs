import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {writeFileSync} from 'node:fs';
const data=new Uint8Array(await fetch('https://www.gwinnetttaxcommissioner.com/PropTaxBill/R6250%20010.pdf').then(r=>r.arrayBuffer()));
const doc=await getDocument({data,isEvalSupported:false,useSystemFonts:true}).promise;
const page=await doc.getPage(1),content=await page.getTextContent();
writeFileSync('lib/property-taxes/__tests__/amwiler-bill.txt',content.items.map(i=>i.str).join('\n'));
