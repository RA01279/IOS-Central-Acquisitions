import PizZip from "pizzip";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoDeck, MemoSlide } from "./memo";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const emu = (v: number) => Math.round(v * 914400);
const xml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
export type MemoImage = { slide: number; data: string; source: string };
export const IMAGE_SLIDES = [1,3,4,5,7,8,9,10,11,12,13,14,15,16,17,19,21,23];
// Only actual PNG/JPEG bytes are accepted. Never fetch model-provided URLs.
export function validateImages(value: unknown): MemoImage[] {
 if (!Array.isArray(value) || value.length > 18) throw new Error("Choose up to 18 exhibits.");
 const used = new Set<number>(); let total = 0;
 return value.map(v => {
  if (!v || !IMAGE_SLIDES.includes(v.slide) || used.has(v.slide) || typeof v.data !== "string" || typeof v.source !== "string" || !v.source.trim() || v.source.length > 500) throw new Error("Each exhibit needs a slide and source.");
  const match = v.data.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error("Exhibits must be PNG or JPEG images.");
  const b = Buffer.from(match[2], "base64"); total += b.length;
  if (b.length > 650000 || total > 2400000 || (match[1] === "png" ? b.subarray(0,8).toString("hex") !== "89504e470d0a1a0a" : b[0] !== 255 || b[1] !== 216 || b[2] !== 255)) throw new Error("Exhibit is invalid or too large. Use the image picker to resize it.");
  dimensions(b, match[1]); used.add(v.slide); return { slide: v.slide, data: v.data, source: v.source };
 });
}
function dimensions(b: Buffer, ext: string): [number, number] {
 let w = 0, h = 0;
 if (ext === "png" && b.length >= 24) { w=b.readUInt32BE(16); h=b.readUInt32BE(20); }
 else {
  let p=2;
  while(p+8<b.length) { if(b[p]!==255) break; const marker=b[p+1]; const len=b.readUInt16BE(p+2); if(len<2) break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){h=b.readUInt16BE(p+5);w=b.readUInt16BE(p+7);break;} p+=2+len;
  }
 }
 if(!w||!h||w>10000||h>10000)throw new Error("Could not read image dimensions."); return [w,h];
}
export function renderMemo(deck: MemoDeck, exhibits: MemoImage[] = []): Buffer {
 const zip = new PizZip(readFileSync(join(process.cwd(), "lib/agents/templates/exec-summary.pptx")));
 let layout=zip.file("ppt/slideLayouts/slideLayout2.xml")!.asText();
 zip.file("ppt/slideLayouts/slideLayout2.xml",layout.replace(/\{\{PROPERTY\}\}/g,xml(deck.property)));
 let contentTypes=zip.file("[Content_Types].xml")!.asText().replace('<Default Extension="png"', '<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png"');
 for(const s of deck.slides) {
  let id=10; let shapes=""; let note=""; const image=exhibits.find(x=>x.slide===s.number);
  function text(t: string[], x: number,y:number,w:number,h:number,size=12,color="162B49",bold=false,fill?:string) {
   const paras=t.map(v=>`<a:p><a:pPr marL="0" indent="0"><a:spcAft><a:spcPts val="500"/></a:spcAft></a:pPr><a:r><a:rPr lang="en-US" sz="${size*100}" b="${bold?1:0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${xml(v)}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>`).join("");
   shapes+=`<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="Memo text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill?`<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>`:'<a:noFill/>'}<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="${emu(.08)}" rIns="${emu(.08)}" tIns="${emu(.04)}" bIns="${emu(.04)}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
  }
  function table(x:number,y:number,w:number,h:number) {
   if(!s.columns.length||!s.rows.length) {text(["Not provided",...s.missing.slice(0,3)],x,y,w,h,12,"66717E");return;}
   const rows=[s.columns,...s.rows]; const cw=emu(w/s.columns.length);
   const heights=rows.map(r=>Math.max(.3,Math.min(.85,Math.max(...r.map(v=>Math.ceil(v.length/Math.max(9,(w/s.columns.length)*12))))*.16+.14)));
   const naturalHeight=heights.reduce((a,b)=>a+b,0); const tableHeight=Math.min(h,naturalHeight);
   const rowXml=rows.map((r,i)=>`<a:tr h="${emu(heights[i]*Math.min(1,h/naturalHeight))}">${r.map(v=>`<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr/><a:r><a:rPr lang="en-US" sz="${s.columns.length>6?850:1000}" b="${i===0?1:0}"><a:solidFill><a:srgbClr val="${i===0?'FFFFFF':'162B49'}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${xml(v)}</a:t></a:r></a:p></a:txBody><a:tcPr marL="45720" marR="45720" marT="45720" marB="45720" anchor="ctr"><a:solidFill><a:srgbClr val="${i===0?'162B49':i%2?'F1F3F6':'FFFFFF'}"/></a:solidFill></a:tcPr></a:tc>`).join('')}</a:tr>`).join('');
   shapes+=`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id++}" name="Editable evidence table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(tableHeight)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${s.columns.map(()=>`<a:gridCol w="${cw}"/>`).join('')}</a:tblGrid>${rowXml}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  }
  function visual(x:number,y:number,w:number,h:number) {
   if(!image){text(["Exhibit needed",s.missing.find(m=>/map|aerial|image|exhibit|model|chart/i.test(m))||"Add the subject-specific source exhibit before circulation."],x,y,w,h,14,"66717E");return;}
   const [mime,b64]=image.data.split(';base64,');const ext=mime.endsWith('png')?'png':'jpeg';const bytes=Buffer.from(b64,'base64'); const [iw,ih]=dimensions(bytes,ext);const scale=Math.min(w/iw,h/ih);const pw=iw*scale,ph=ih*scale;
   zip.file(`ppt/media/memo-${s.number}.${ext}`,bytes);
   note+=`\nExhibit source: ${image.source}`;
   shapes+=`<p:pic><p:nvPicPr><p:cNvPr id="${id++}" name="Source exhibit" descr="${xml(image.source)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${emu(x+(w-pw)/2)}" y="${emu(y+(h-ph)/2)}"/><a:ext cx="${emu(pw)}" cy="${emu(ph)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  }
  const bullets=s.bullets.length?s.bullets:["Not provided. See source requirements in the slide notes."];
  if(s.number===1){visual(2.34,1.31,5.31,3.54);text([deck.property],.19,5.6,9.61,.6,24,"162B49",true);text([deck.date+" — Draft for review"],.15,6.38,8,.35,10);}
  else {
   text(["> "+s.title],0,.8,10,.47,s.title.length>65?12:16,"FFFFFF",true,"132B46");
   text([String(s.number)],9.2,7.12,.4,.22,8,"66717E");
   switch(s.number) {
    case 2: text(bullets,.18,1.48,5.55,5.35,12); table(5.9,1.55,3.88,5.05);break;
    case 8: text(bullets,.3,1.5,3.35,5.2,12);visual(3.82,1.5,5.9,5.15);break;
    case 11: visual(.25,1.45,9.5,3.75);text(bullets,.3,5.25,9.4,1.55,10);break;
    case 12: visual(1.85,1.5,6.3,4.5);text(bullets,.4,6.05,9.2,.7,10);break;
    case 13: visual(.45,1.6,2.5,4.8);text(bullets,3.25,1.52,6.4,5.2,12);break;
    case 3: case 4: case 5: case 9: case 10: case 19: case 21: case 23:
     visual(.25,1.45,9.5,4.9);text(bullets,.3,6.4,9.4,.48,9);break;
    case 7: text(bullets,.3,1.5,4.2,5.15,12); if(image)visual(4.65,1.5,5.1,5.15);else table(4.65,1.5,5.1,5.15);break;
    case 14: case 15: case 16: case 17:
     if(image)visual(.3,1.45,9.4,5.2);else table(.35,1.5,9.3,4.25);text(bullets,.35,image?6.7:5.9,9.3,image?.23:.9,9);break;
    case 24: case 25: table(2.25,1.8,5.5,4.35);text(bullets,.4,6.3,9.2,.5,9);break;
    default: table(.35,1.55,9.3,4.5);text(bullets,.35,6.2,9.3,.65,9);
   }
   text(["DRAFT • "+(s.missing.length?"Open items in notes • ":"")+"Sources: "+s.sources.slice(0,2).join("; ").slice(0,170)],.25,6.95,8.9,.3,7,"66717E");
  }
  const path=`ppt/slides/slide${s.number}.xml`;
  zip.file(path,zip.file(path)!.asText().replace("</p:spTree>",shapes+"</p:spTree>"));
  const relPath=`ppt/slides/_rels/slide${s.number}.xml.rels`;
  let rels=zip.file(relPath)!.asText().replace("</Relationships>",`<Relationship Id="rIdNotes" Type="${R}/notesSlide" Target="../notesSlides/notesSlide${s.number}.xml"/>${image?`<Relationship Id="rIdImage" Type="${R}/image" Target="../media/memo-${s.number}.${image.data.startsWith('data:image/png')?'png':'jpeg'}"/>`:''}</Relationships>`);
  zip.file(relPath,rels);
  const notes=["Draft for review",...s.sources.map(v=>"Source: "+v),...s.missing.map(v=>"Open item: "+v),...s.bullets,note].filter(Boolean);
  zip.file(`ppt/notesSlides/notesSlide${s.number}.xml`,`<p:notes xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${notes.map(t=>`<a:p><a:r><a:t>${xml(t)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);
  zip.file(`ppt/notesSlides/_rels/notesSlide${s.number}.xml.rels`,`<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/slide" Target="../slides/slide${s.number}.xml"/></Relationships>`);
  contentTypes=contentTypes.replace("</Types>",`<Override PartName="/ppt/notesSlides/notesSlide${s.number}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>`);
 }
 zip.file('[Content_Types].xml',contentTypes);
 return zip.generate({type:"nodebuffer",compression:"DEFLATE"});
}
