import { saleGrid, PDF_SALE_COLUMNS } from './pdf-sale-layout';
/** Server text extraction preserves the grid coordinates and source page. */
export async function pdfSaleTables(buffer:Buffer) {
 const canvas=await import('@napi-rs/canvas');
 if(!(globalThis as any).DOMMatrix)(globalThis as any).DOMMatrix=canvas.DOMMatrix;
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const doc=await pdfjs.getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:true}).promise;
 const rows:ReturnType<typeof saleGrid>=[];
 try {
  if(doc.numPages>400)throw Error('PDF exceeds 400 pages; select the relevant comp pages.');
  for(let pageNumber=1;pageNumber<=doc.numPages;pageNumber++){
   const page=await doc.getPage(pageNumber),viewport=page.getViewport({scale:1}),content=await page.getTextContent();
   rows.push(...saleGrid(content.items.filter((i:any)=>'str'in i).map((i:any)=>{const t=pdfjs.Util.transform(viewport.transform,i.transform);return{text:i.str,x:t[4],y:t[5],width:i.width};}),pageNumber));
  }
 }finally{await doc.destroy();}
 return {rows,text:rows.length?[PDF_SALE_COLUMNS.join('\t'),...rows.map(r=>r.tableRow.join('\t'))].join('\n'):''};
}
