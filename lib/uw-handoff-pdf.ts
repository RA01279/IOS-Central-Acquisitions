import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { OVERVIEW, MARKET, LEASE_FIELDS, capexFields, capexSchedule, displayValue, missingInputs, type Handoff, type Field, type Values } from './uw-handoff';

/** Saved instructions only. No inferred assumptions and no truncation of entered text. */
export async function handoffPdf(h:Handoff, savedAt:string, revision:number):Promise<Uint8Array> {
  const doc=await PDFDocument.create(); doc.registerFontkit(fontkit);
  const [regularBytes,boldBytes,logo]=await Promise.all([
    readFile(path.join(process.cwd(),'public/fonts/handoff-regular.woff')),
    readFile(path.join(process.cwd(),'public/fonts/handoff-bold.woff')),
    readFile(path.join(process.cwd(),'public/logo-navy.svg'),'utf8'),
  ]);
  const regular=await doc.embedFont(regularBytes,{subset:true}), bold=await doc.embedFont(boldBytes,{subset:true});
  const navy=rgb(10/255,37/255,64/255), blue=rgb(14/255,90/255,167/255), muted=rgb(107/255,122/255,136/255), line=rgb(221/255,228/255,235/255);
  const left=42,width=528,bottom=48,lineHeight=13,size=9;
  let page!:PDFPage,y=0;
  const date=new Date(savedAt).toLocaleString('en-US',{timeZone:'UTC',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' UTC';
  function clean(text:string){return text.replace(/\t/g,'    ').replace(/\r/g,'').replace(/[\u2010-\u2015]/g,'-');}
  function wrap(text:string,max:number,font:PDFFont=regular,fontSize=size):string[]{
    const lines:string[]=[];
    for(const paragraph of clean(text).split('\n')){
      let current='';
      for(const word of paragraph.split(/\s+/)){
        if(!word)continue;
        if(current && font.widthOfTextAtSize(current+' '+word,fontSize)>max){lines.push(current);current='';}
        for(const char of word){if(font.widthOfTextAtSize(current+char,fontSize)>max && current){lines.push(current);current='';}current+=char;}
        current+=' ';
      }
      lines.push(current.trimEnd());
    }
    return lines;
  }
  function newPage(){page=doc.addPage([612,792]);y=748;
    page.drawText('HOPPER / UNDERWRITING HANDOFF',{x:left,y,size:8,font:bold,color:blue});y-=24;
    if(doc.getPageCount()>1){page.drawText('Underwriting Instructions - Continued',{x:left,y,size:13,font:bold,color:navy});y-=24;}
  }
  function ensure(height:number){if(y-height<bottom)newPage();}
  function text(value:string,font=regular,fontSize=size,color=navy){for(const valueLine of wrap(value,width,font,fontSize)){ensure(lineHeight);page.drawText(valueLine,{x:left,y,size:fontSize,font,color});y-=lineHeight;}}
  function section(title:string){ensure(50);y-=9;page.drawLine({start:{x:left,y},end:{x:left+44,y},thickness:3,color:blue});y-=20;text(title,bold,12);y-=4;}
  function row(cells:string[],widths:number[],header=false){
    const lines=cells.map((cell,i)=>wrap(cell,widths[i]-14,header?bold:regular));let cursor=0,total=Math.max(...lines.map(a=>a.length));
    while(cursor<total){ensure(24);const available=Math.max(1,Math.floor((y-bottom-9)/lineHeight));const count=Math.min(total-cursor,available);let x=left;
      if(header)page.drawRectangle({x:left,y:y-count*lineHeight-4,width,height:count*lineHeight+8,color:rgb(.94,.96,.98)});
      lines.forEach((values,i)=>{values.slice(cursor,cursor+count).forEach((value,j)=>page.drawText(value,{x:x+7,y:y-j*lineHeight,size,font:header||i===0?bold:regular,color:header?blue:navy}));x+=widths[i];});
      y-=count*lineHeight+8;page.drawLine({start:{x:left,y:y+3},end:{x:left+width,y:y+3},thickness:.4,color:line});cursor+=count;
      if(cursor<total)newPage();
    }
  }
  function fields(definitions:Field[],values:Values){for(const f of definitions)if(values[f.key]!==undefined && values[f.key]!=='')row([f.label,displayValue(f,values[f.key])],[170,358]);}
  newPage();
  // Use the official wordmark paths, retaining their original geometry.
  for(const match of logo.matchAll(/<path\b[^>]*\bd="([^"]+)"/g))page.drawSvgPath(match[1],{x:445,y:754,scale:.48,color:navy});
  for(const match of logo.matchAll(/<polygon\b[^>]*\bpoints="([^"]+)"/g)){const points=match[1].trim().split(/\s+/).map(pair=>pair.split(',').join(' '));page.drawSvgPath('M'+points.join(' L')+' Z',{x:445,y:754,scale:.48,color:navy});}
  for(const match of logo.matchAll(/<rect\b[^>]*>/g)){const attrs=Object.fromEntries([...match[0].matchAll(/(x|y|width|height)="([^"]+)"/g)].map(a=>[a[1],Number(a[2])]));page.drawSvgPath('M'+attrs.x+' '+attrs.y+' h'+attrs.width+' v'+attrs.height+' h-'+attrs.width+' Z',{x:445,y:754,scale:.48,color:navy});}
  y-=18;
  text(h.overview.property || 'Underwriting Handoff',bold,18);y-=3;
  if(h.overview.address && h.overview.address!==h.overview.property)text(h.overview.address,regular,10,muted);
  text('Saved '+date+' | Revision '+revision,regular,8,muted);y-=6;
  text('All dollar amounts are USD. Missing inputs are listed at the end; 0 is a confirmed zero.',regular,8,muted);
  section('Deal Overview');fields(OVERVIEW.filter(f=>!['property','address','plan','folder'].includes(f.key)),h.overview);
  if(h.overview.plan){section('Business Plan / Modeling Instructions');text(h.overview.plan);}
  section('Market Leasing Assumptions');fields(MARKET,h.market);
  ensure(120);section('New Lease vs. Renewal');row(['Assumption','New Lease','Renewal'],[170,179,179],true);
  for(const f of LEASE_FIELDS)if(h.newLease[f.key]!=='' || h.renewal[f.key]!=='')row([f.label,displayValue(f,h.newLease[f.key]),displayValue(f,h.renewal[f.key])],[170,179,179]);
  section('Capital Plan');
  text(h.capexPlan==='None'?'Confirmed: no capex planned ($0).':h.capexPlan==='Projects'?'Project costs are separate from TI, LC and operating expenses.':'Capex plan: Not provided.');
  h.capex.forEach((project,i)=>{section('Project '+(i+1)+': '+(project.description||'Description not provided'));text(capexSchedule(project));fields(capexFields(project).filter(f=>!['description','timing','month','start','end'].includes(f.key)),project);});
  if(h.capex.length)text('Coordinate make-ready work with leasing downtime. Count each cost and each downtime period once.',regular,8,muted);
  if(h.notes){section('Additional Instructions');text(h.notes);}
  if(h.overview.folder){section('Source Folder');text(h.overview.folder,regular,8,blue);}
  const missing=missingInputs(h);
  if(missing.length){section('Open Inputs ('+missing.length+')');text('Not provided - confirm before modeling; do not substitute assumptions.',regular,8,muted);
    for(const group of ['Deal','Market','New lease','Renewal','Capex','Project']){const entries=missing.filter(v=>group==='Capex'?v.startsWith('Capex'):v.startsWith(group+ (group==='Project'?' ':':')));if(entries.length)text(group+': '+entries.map(v=>v.startsWith(group+': ')?v.slice(group.length+2):v).join('; '),regular,8,muted);}
  }
  doc.getPages().forEach((p,i)=>{p.drawLine({start:{x:left,y:35},end:{x:left+width,y:35},thickness:.5,color:line});p.drawText('Underwriting instructions | Revision '+revision,{x:left,y:22,size:7,font:regular,color:muted});p.drawText((i+1)+' / '+doc.getPageCount(),{x:540,y:22,size:7,font:regular,color:muted});});
  doc.setTitle((h.overview.property||'IOS')+' - UW Handoff');doc.setAuthor('Dalfen Industrial');doc.setSubject('Saved underwriting instructions');
  return doc.save();
}


