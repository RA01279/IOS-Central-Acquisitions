// scripts/prepare-ic-template.cjs
// Builds lib/ic-deck/templates/ic-deck.pptx from a finished executive-summary
// deck: keeps the slide size, master, the two layouts, theme and the two Dalfen
// logos, and nothing else. No slide content, photos, maps, notes or embedded
// workbooks survive, so no deal's facts can leak into another deal's deck.
// Usage: node scripts/prepare-ic-template.cjs "<reference.pptx>" "<property name in its footer>"
const fs = require("node:fs");
const PizZip = require("pizzip");

const [referencePath, propertyName] = process.argv.slice(2);
if (!referencePath || !propertyName) {
  console.error('Usage: node scripts/prepare-ic-template.cjs "<reference.pptx>" "<property name>"');
  process.exit(1);
}
const SLIDES = 23;
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const escaped = propertyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "(?:'|&apos;|’)");

const source = new PizZip(fs.readFileSync(referencePath));
const out = new PizZip();
for (const name of Object.keys(source.files)) {
  if (source.files[name].dir || !/^ppt\/(slideMasters|slideLayouts|theme)\//.test(name)) continue;
  // Only theme1 belongs to the slide master; the notes/handout themes go with their masters.
  if (/^ppt\/theme\/theme(?!1\.xml)/.test(name)) continue;
  out.file(name, source.file(name).asText().replace(new RegExp(escaped, "g"), "{{PROPERTY}}"));
}
for (const name of ["ppt/media/image1.png", "ppt/media/image2.png"]) out.file(name, source.file(name).asNodeBuffer());

const presentation = source.file("ppt/presentation.xml").asText()
  .replace(/<p:notesMasterIdLst>.*?<\/p:notesMasterIdLst>/s, "")
  .replace(/<p:handoutMasterIdLst>.*?<\/p:handoutMasterIdLst>/s, "")
  .replace(/<p:extLst>.*?<\/p:extLst>/s, "")
  .replace(/<p:sldIdLst>.*?<\/p:sldIdLst>/s, () =>
    "<p:sldIdLst>" + Array.from({ length: SLIDES }, (_, i) => `<p:sldId id="${256 + i}" r:id="rIdS${i + 1}"/>`).join("") + "</p:sldIdLst>");
out.file("ppt/presentation.xml", presentation);
const masterRels = source.file("ppt/_rels/presentation.xml.rels").asText().match(/<Relationship\b[^>]+\/>/g)
  .filter((r) => /relationships\/(slideMaster|theme)"/.test(r));
const slideRels = Array.from({ length: SLIDES }, (_, i) =>
  `<Relationship Id="rIdS${i + 1}" Type="${R}/slide" Target="slides/slide${i + 1}.xml"/>`);
out.file("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="${REL}">${masterRels.join("")}${slideRels.join("")}</Relationships>`);

for (let i = 1; i <= SLIDES; i++) {
  out.file(`ppt/slides/slide${i}.xml`, `<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
  out.file(`ppt/slides/_rels/slide${i}.xml.rels`, `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout${i === 1 ? 1 : 2}.xml"/></Relationships>`);
}
out.file("_rels/.rels", `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);

const kind = (n) => n === "ppt/presentation.xml" ? "presentationml.presentation.main"
  : n.includes("/slides/") ? "presentationml.slide"
  : n.includes("/slideLayouts/") ? "presentationml.slideLayout"
  : n.includes("/slideMasters/") ? "presentationml.slideMaster" : "theme";
let overrides = "";
for (const n of Object.keys(out.files)) {
  if (!n.endsWith(".xml") || n.includes("_rels")) continue;
  overrides += `<Override PartName="/${n}" ContentType="application/vnd.openxmlformats-officedocument.${kind(n)}+xml"/>`;
}
out.file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>${overrides}</Types>`);

const leftover = Object.keys(out.files).filter((n) => !out.files[n].dir && out.file(n).asText && /\.xml$/.test(n) && new RegExp(escaped).test(out.file(n).asText()));
if (leftover.length) { console.error("Property name still present in: " + leftover.join(", ")); process.exit(1); }
fs.mkdirSync("lib/ic-deck/templates", { recursive: true });
fs.writeFileSync("lib/ic-deck/templates/ic-deck.pptx", out.generate({ type: "nodebuffer", compression: "DEFLATE" }));
console.log(`Saved lib/ic-deck/templates/ic-deck.pptx: ${SLIDES} blank slides, master, 2 layouts, theme, 2 logos.`);
