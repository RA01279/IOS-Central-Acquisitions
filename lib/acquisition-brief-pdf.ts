import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { briefPct, type AcquisitionBrief } from "./acquisition-brief";

/** Fixed one-page executive brief; full supporting rows and warnings remain in preview. */
export async function acquisitionBriefPdf(b: AcquisitionBrief) {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const [regularBytes, boldBytes, logo] = await Promise.all([
    readFile(path.join(process.cwd(), "public/fonts/handoff-regular.woff")),
    readFile(path.join(process.cwd(), "public/fonts/handoff-bold.woff")),
    readFile(path.join(process.cwd(), "public/logo-navy.svg"), "utf8"),
  ]);
  const regular = await doc.embedFont(regularBytes, { subset: true }), bold = await doc.embedFont(boldBytes, { subset: true });
  const page = doc.addPage([612, 792]), navy = rgb(.039,.145,.251), blue = rgb(.055,.353,.655), muted = rgb(.42,.48,.53), line = rgb(.87,.89,.92);
  const clean = (s: string) => s.replace(/[\r\n\t]+/g, " ").replace(/[\u2010-\u2015]/g, "-");
  function fit(s: string, width: number, font: PDFFont, size: number) {
    let value = clean(s); if (font.widthOfTextAtSize(value, size) <= width) return value;
    while (value.length && font.widthOfTextAtSize(value + "...", size) > width) value = value.slice(0, -1);
    return value.trimEnd() + "...";
  }
  const text = (s: string, x: number, y: number, size = 9, strong = false, width = 528, color = navy) => page.drawText(fit(s,width,strong ? bold : regular,size), { x,y,size,font:strong ? bold : regular,color });
  let y = 748;
  text("ACQUISITION BRIEF",42,y,10,true,340,blue);
  // Official bundled wordmark geometry.
  for (const match of logo.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)) page.drawSvgPath(match[1], { x:450,y:760,scale:.47,color:navy });
  for (const match of logo.matchAll(/<polygon\b[^>]*\bpoints="([^"]+)"/g)) page.drawSvgPath("M" + match[1].trim().split(/\s+/).map(p=>p.split(",").join(" ")).join(" L") + " Z", { x:450,y:760,scale:.47,color:navy });
  for (const match of logo.matchAll(/<rect\b[^>]*>/g)) { const a=Object.fromEntries([...match[0].matchAll(/(x|y|width|height)="([^"]+)"/g)].map(m=>[m[1],Number(m[2])])); page.drawSvgPath(`M${a.x} ${a.y} h${a.width} v${a.height} h-${a.width} Z`,{x:450,y:760,scale:.47,color:navy}); }
  y-=34; text(b.address,42,y,21,true); y-=18; text(`${b.location} | ${b.assetClass} | ${b.stage}`,42,y,9); y-=17; text(b.property,42,y,9,false,528,muted);
  y-=22; text(`${b.historical ? "HISTORICAL " : ""}MODEL v${b.versionNumber} | ${b.identityConfirmed ? "Identity confirmed" : "DRAFT - IDENTITY UNCONFIRMED"}`,42,y,9,true,528,blue);
  y-=15; text(`Source: ${b.fileName}`,42,y,8,false,528,muted);
  y-=14; text(`Uploaded: ${b.uploadedAt ?? "Not recorded"} | Saved calculations; not recalculated`,42,y,8,false,528,muted);
  y-=36;
  b.metrics.forEach((m,i)=> { const x=42+i*135; text(m.label.toUpperCase(),x,y,8,true,124,muted); text(m.value,x,y-24,17,true,124); });
  y-=54;
  function section(title: string) { page.drawLine({start:{x:42,y},end:{x:570,y},thickness:.7,color:line}); y-=19;text(title,42,y,10,true,528,blue);y-=20; }
  section("MODEL RETURNS | percent, common scale");
  const extent=Math.max(.1,...b.returns.map(r=>Math.abs(r.value ?? 0)));
  b.returns.forEach(r=> { text(r.label,42,y,8,false,165); const axis=325, span=135; page.drawLine({start:{x:190,y:y+3},end:{x:460,y:y+3},thickness:1,color:line}); page.drawLine({start:{x:axis,y:y-3},end:{x:axis,y:y+9},thickness:1,color:muted}); if(r.value!=null){const w=Math.abs(r.value)/extent*span;page.drawRectangle({x:r.value<0?axis-w:axis,y:y-1,width:Math.max(w,.5),height:8,color:blue});}text(briefPct(r.value),476,y,9,true,94); y-=20; });
  text(`Left: negative | center: 0% | right: positive | axis ends: +/-${(extent*100).toFixed(1)}%`,190,y+3,7,false,380,muted);y-=16;
  section("MODEL LEASE & TENANT ASSUMPTIONS | not verified contract facts");
  if(!b.tenants.length){text("Tenant, lease dates and base rent: Not available in saved model",42,y);y-=17;}
  for(const t of b.tenants.slice(0,3)){text(`${t.tenant} | Base rent ${t.rent}/year`,42,y,9,true);y-=14;text(`Lease ${t.start} to ${t.expiration} | Market rent ${t.marketRent}/year`,42,y,8,false,528,muted);y-=17;}
  if(b.tenants.length>3){text(`+${b.tenants.length-3} additional tenants in the online preview`,42,y,8,false,528,muted);y-=15;}
  section("MODEL ASSUMPTIONS & RECORDED EVIDENCE");
  for(const r of b.assumptions){text(r.label,42,y,8,true,170);text(r.value,218,y,8,false,352);y-=16;}
  for(const r of b.facts){text(r.label,42,y,8,true,170);text(r.value,218,y,8,false,352);y-=16;}
  y-=4; text(`Review warnings: ${b.warnings.length}. ${b.warnings[0] ?? "No parser warnings recorded."}`,42,y,8,true,528);y-=14;
  text("Full warnings and unabridged supporting rows are in the online preview. No lease citations inferred.",42,y,7,false,528,muted);
  page.drawLine({start:{x:42,y:39},end:{x:570,y:39},thickness:.5,color:line});
  text(`Dalfen Industrial | Confidential | Draft for review | Model v${b.versionNumber}`,42,25,7,false,528,muted);
  if(y<48) throw new Error("Brief exceeds its one-page layout.");
  doc.setTitle(`Acquisition Brief - ${b.address} - v${b.versionNumber}`);
  return doc.save();
}
