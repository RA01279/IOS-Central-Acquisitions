import fs from 'node:fs';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
fs.mkdirSync('.scratch/starpoint-sales',{recursive:true});
const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync('C:/Users/randerson/Downloads/Starpoint Sale Comps 10.12.26.pdf')),isEvalSupported:false}).promise;
let pages=[];
for(let i=1;i<=doc.numPages;i++){
 const page=await doc.getPage(i),content=await page.getTextContent();
 const items=content.items.filter(x=>'str'in x); const lines=[];
 for(const it of items){let l=lines.find(l=>Math.abs(l.y-it.transform[5])<2);if(!l){l={y:it.transform[5],items:[]};lines.push(l);}l.items.push({x:it.transform[4],text:it.str});}
 const text=lines.sort((a,b)=>b.y-a.y).map(l=>l.items.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' | ')).join('\n');
 pages.push({page:i,text,items:items.map(x=>({text:x.str,x:x.transform[4],y:x.transform[5],width:x.width}))});
 const viewport=page.getViewport({scale:2}),canvas=createCanvas(viewport.width,viewport.height);
 await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
 fs.writeFileSync(`.scratch/starpoint-sales/page-${i}.png`,canvas.toBuffer('image/png'));
 console.log(`PAGE ${i}\n${text}`);
}
fs.writeFileSync('.scratch/starpoint-sales/pages.json',JSON.stringify(pages,null,2));
await doc.destroy();
