// scripts/make-loi-template.mjs
// Builds the Hopper LOI template from the team's REAL sent LOI (4829 Railroad
// St) rather than the blank form -- that letter carries the letterhead, the
// TX title contact, and John's + Rhett's signature blocks (with signature
// images), all of which survive templating untouched. Concrete deal values
// are replaced with {tags}.
//   node scripts/make-loi-template.mjs <example.docx> <tagged-out.docx> [test-out.docx]

import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { readFileSync, writeFileSync } from "fs";

const [srcPath, outPath, testPath] = process.argv.slice(2);
if (!srcPath || !outPath) {
  console.error("usage: node make-loi-template.mjs <example.docx> <tagged.docx> [test.docx]");
  process.exit(1);
}

const zip = new PizZip(readFileSync(srcPath));
let xml = zip.file("word/document.xml").asText();

// Run-boundary junk (Word splits text across runs arbitrarily).
const J = "(?:<[^>]+>|\\s)*";
function flex(text) {
  return text
    .split("")
    .map((ch) => (ch === " " ? J : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join(J);
}
function sub(literal, replacement, label = literal) {
  const re = new RegExp(flex(literal));
  const before = xml;
  xml = xml.replace(re, () => replacement);
  if (xml === before) console.warn(`WARN: no match for "${label}"`);
}

// --- deal fields -------------------------------------------------------------
sub("(912) 508-4170", "{tel}");
sub("July 8, 2026", "{date}");
sub("Cole Bercher, Welcome Group", "{attn}");
sub("from its current ownership", "from {seller_clause}");
sub("4825 Railroad St, Deer Park, TX 77536", "{property_description}");
sub("$2,200,000", "${price}");
sub("Thirty-Five Thousand ($35,000)", "{deposit_words} (${deposit_amount})");
sub("Forty Five (45)", "{dd_days}");
sub("twenty (20)", "{closing_days}");
sub("Cole Bercher of Welcome Group", "{broker_clause_name}");
sub("herein; Seller will pay", "herein; {commission_payer} will pay");
sub("agreed upon by Seller and Broker", "agreed upon by {commission_payer} and Broker");

// --- signature block (both signers editable; images stay put) ----------------
sub("John Lettieri", "{signer1_name}");
sub("Rhett Anderson", "{signer2_name}");
sub("Market Officer | Central", "{signer1_title}");
sub("IOS Market Lead | Central", "{signer2_title}");

// --- acknowledgment year, anchored after "Date:" so rsid attributes are safe --
{
  const anchor = xml.search(new RegExp(flex("Date:")));
  const re = new RegExp(flex(", 2026"));
  const tail = anchor >= 0 ? xml.slice(anchor) : "";
  if (anchor >= 0 && re.test(tail)) {
    xml = xml.slice(0, anchor) + tail.replace(re, ", {year}");
  } else {
    console.warn("WARN: acknowledgment year not found after Date:");
  }
}

zip.file("word/document.xml", xml);
writeFileSync(outPath, zip.generate({ type: "nodebuffer" }));
console.log(`Tagged template written: ${outPath}`);

// Verify no stray tags remain unreplaced in visible text.
{
  const text = xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");
  for (const needle of ["Cole Bercher", "2,200,000", "35,000", "Railroad", "July 8"]) {
    if (text.includes(needle)) console.warn(`LEFTOVER: "${needle}" still present`);
  }
  console.log("Verify pass complete.");
}

// --- test render ---------------------------------------------------------------
if (testPath) {
  // Date defaults to TODAY (America/Chicago), exactly as the app will do.
  const now = new Date();
  const todayLong = now.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const data = {
    tel: "(912) 508-4170",
    date: todayLong,
    attn: "Preston Fleenor",
    seller_clause: "its current ownership",
    property_description: "1717 Shady Oaks Dr, Denton, TX 76205",
    price: "2,800,000",
    deposit_words: "Fifty Thousand",
    deposit_amount: "50,000",
    dd_days: "Sixty (60)",
    closing_days: "thirty (30)",
    broker_clause_name: "Preston Fleenor",
    commission_payer: "Seller",
    signer1_name: "John Lettieri",
    signer1_title: "Market Officer | Central",
    signer2_name: "Rhett Anderson",
    signer2_title: "IOS Market Lead | Central",
    year: String(now.getFullYear()),
  };
  const zip2 = new PizZip(readFileSync(outPath));
  const doc = new Docxtemplater(zip2, { paragraphLoop: true, linebreaks: true });
  doc.render(data);
  writeFileSync(testPath, doc.getZip().generate({ type: "nodebuffer" }));
  console.log(`Test rendered: ${testPath}`);
}
