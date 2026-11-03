import {readFileSync,writeFileSync} from 'node:fs';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createCanvas} from '@napi-rs/canvas';
const path='docs/tax-system-audit-20261026/dallas/'+(process.argv[2]??'summary.pdf');
const d=await getDocument({data:new Uint8Array(readFileSync(path)),isEvalSupported:false,useSystemFonts:false,standardFontDataUrl:new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')}).promise;
for(let n=1;n<=d.numPages;n++){const p=await d.getPage(n),c=await p.getTextContent();console.log('PAGE',n,c.items.map(i=>i.str??'').join(' | '));if(process.argv.includes('--render')){const v=p.getViewport({scale:1.4}),canvas=createCanvas(Math.ceil(v.width),Math.ceil(v.height));await p.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;writeFileSync(path+`-${n}.png`,canvas.toBuffer('image/png'));writeFileSync(path+`-${n}.json`,JSON.stringify(c.items.filter(i=>i.str?.trim()).map(i=>({text:i.str.trim(),x:i.transform[4],y:i.transform[5]})),null,2));}}
await d.destroy();
