const fs=require('node:fs'); const PizZip=require('pizzip');
const source=new PizZip(fs.readFileSync(process.argv[2])); const out=new PizZip();
const REL='http://schemas.openxmlformats.org/package/2006/relationships';
for(const name of Object.keys(source.files)) if(/^ppt\/(slideMasters|slideLayouts|theme)\//.test(name)&&!source.files[name].dir){
 let data=source.file(name).asText().replace(/12803 O(?:’|&apos;|')Connor Rd/g,'{{PROPERTY}}');
 out.file(name,data);
}
for(const name of ['ppt/media/image1.png','ppt/media/image2.png']) out.file(name,source.file(name).asNodeBuffer());
let presentation=source.file('ppt/presentation.xml').asText().replace(/<p:notesMasterIdLst>.*?<\/p:notesMasterIdLst>/s,'').replace(/<p:handoutMasterIdLst>.*?<\/p:handoutMasterIdLst>/s,'').replace(/<p:extLst>.*?<\/p:extLst>/s,'');
out.file('ppt/presentation.xml',presentation);
const presRels=source.file('ppt/_rels/presentation.xml.rels').asText().match(/<Relationship\b[^>]+\/>/g).filter(r=>/relationships\/(slide|slideMaster)"/.test(r));
out.file('ppt/_rels/presentation.xml.rels',`<Relationships xmlns="${REL}">${presRels.join('')}</Relationships>`);
const P='http://schemas.openxmlformats.org/presentationml/2006/main',A='http://schemas.openxmlformats.org/drawingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
for(let i=1;i<=25;i++){
 out.file(`ppt/slides/slide${i}.xml`,`<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
 out.file(`ppt/slides/_rels/slide${i}.xml.rels`,`<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout${i===1?1:2}.xml"/></Relationships>`);
}
out.file('_rels/.rels',`<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
const type=(n)=>n==='ppt/presentation.xml'?'presentation.main':n.includes('/slides/')?'slide':n.includes('/slideLayouts/')?'slideLayout':n.includes('/slideMasters/')?'slideMaster':null;
let overrides='';for(const n of Object.keys(out.files)){if(!n.endsWith('.xml'))continue; const t=type(n); const ct=t?`application/vnd.openxmlformats-officedocument.presentationml.${t}+xml`:'application/vnd.openxmlformats-officedocument.theme+xml'; overrides+=`<Override PartName="/${n}" ContentType="${ct}"/>`;}
out.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/>${overrides}</Types>`);
fs.mkdirSync('lib/agents/templates',{recursive:true});fs.writeFileSync('lib/agents/templates/exec-summary.pptx',out.generate({type:'nodebuffer',compression:'DEFLATE'}));
console.log('Saved sanitized 25-slide template, original layouts/theme and two branding assets only.');
