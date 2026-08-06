// scripts/make-loi-slb-template.mjs
// Builds the SALE-LEASEBACK LOI template from the team's real sent SLB LOI
// (14150 Gulf Fwy). Same approach as make-loi-template.mjs: concrete values
// -> {tags}; letterhead + signature images survive untouched. Also cleans up
// bracket remnants around the title contacts (keeps Heather / TX only).
//   node scripts/make-loi-slb-template.mjs <example.docx> <tagged-out.docx> [test-out.docx]

import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { readFileSync, writeFileSync } from "fs";

const [srcPath, outPath, testPath] = process.argv.slice(2);
if (!srcPath || !outPath) {
  console.error("usage: node make-loi-slb-template.mjs <example.docx> <tagged.docx> [test.docx]");
  process.exit(1);
}

const zip = new PizZip(readFileSync(srcPath));
let xml = zip.file("word/document.xml").asText();

const J = "(?:<[^>]+>|\\s)*";
function flex(text) {
  return text
    .split("")
    .map((ch) => {
      if (ch === " ") return J;
      if (ch === "&") return `(?:&amp;|&)${J}`;
      return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") ;
    })
    .join(J);
}
function sub(literal, replacement, { all = false, label } = {}) {
  const re = new RegExp(flex(literal), all ? "g" : "");
  const before = xml;
  xml = xml.replace(re, () => replacement);
  if (xml === before) console.warn(`WARN: no match for "${label ?? literal}"`);
}
function dropParagraphs(marker) {
  const re = new RegExp(`<w:p\\b[^>]*>(?:(?!</w:p>)[\\s\\S])*?${flex(marker)}(?:(?!</w:p>)[\\s\\S])*?</w:p>`, "g");
  const before = xml;
  xml = xml.replace(re, "");
  if (xml === before) console.warn(`WARN: no paragraph dropped for "${marker}"`);
}

// --- header -------------------------------------------------------------
sub("912-508-4170", "{tel}", { all: true });
sub("randerson@dalfen.com", "{sender_email}", { all: true });

// --- dates (letter date first; the distinct expiry date after) -----------
sub("July 21, 2026", "{date}");
sub("July 28, 2026", "{expiry_date}");

// --- recipient block ------------------------------------------------------
sub("Lonestar RV", "{seller_name}", { all: true });
sub("Matt Venezia", "{attn}");
sub("Matthews", "{broker_firm}", { all: true });
sub("515 Post Oak Blvd, Suite 910", "{broker_address1}");
sub("Houston, TX 77027", "{broker_address2}");

// --- property / economics ---------------------------------------------------
sub("14150 Gulf Fwy, Houston, TX 77034", "{property_description}", { all: true });
sub("Five Million, Two Hundred & Fifty Thousand", "{price_words}");
sub("5,250,000", "{price}");

// The lease rate is a COMPOSED PHRASE ({rent_phrase}) so it can be quoted as
// total $/month, $/acre/month, $/SF-of-building/month, or $/SF/year with
// correct grammar in both places it appears. Replace whole phrases BEFORE
// the numeric subs below.
sub("a blended monthly base rental rate of $34,500", "{rent_phrase}");
sub(
  "a blended base lease rate of $34,500 + Triple Net (NNN) per month per square foot",
  "{rent_phrase}, Triple Net (NNN),"
);

// Fix the original letter's "19,928 SF& 4.68" spacing in one shot.
sub("19,928 SF& 4.68", "{building_sf} SF & {acres}", { label: "SF & acres spacing" });
sub("19,928", "{building_sf}", { all: true });
sub("4.68", "{acres}", { all: true });
sub("3-year", "{lease_term_years}-year", { all: true });
sub("3.75", "{escalations}", { all: true });
sub("Fifty Thousand", "{deposit_words}");
sub("50,000", "{deposit_amount}");
sub("Forty Five (45)", "{dd_days}");
sub("Thirty (30)", "{closing_days}");

// --- broker commission payer -------------------------------------------------
sub("Buyer shall pay Broker", "{commission_payer} shall pay Broker");
sub("agreed upon by Buyer and Broker", "agreed upon by {commission_payer} and Broker");

// --- title contacts: drop Margo, unwrap Heather's stray brackets --------------
dropParagraphs("Margo Zhao");
dropParagraphs("mzhao@onwardtitle.com");
dropParagraphs("561-7444");
sub("[Heather", "Heather", { label: "Heather open bracket" });
{
  const re = new RegExp(`2364${J}\\]`);
  const before = xml;
  xml = xml.replace(re, () => "2364");
  if (xml === before) console.warn("WARN: Heather close bracket not found");
}

// --- signature block -----------------------------------------------------------
sub("John Lettieri", "{signer1_name}");
sub("Rhett Anderson", "{signer2_name}");
sub("Market Officer | Central", "{signer1_title}");
sub("IOS Market Lead | Central", "{signer2_title}");

// --- acknowledgment year, anchored after "Date:" --------------------------------
{
  const anchor = xml.search(new RegExp(flex("Date:")));
  const re = new RegExp(flex(", 2022"));
  const tail = anchor >= 0 ? xml.slice(anchor) : "";
  if (anchor >= 0 && re.test(tail)) {
    xml = xml.slice(0, anchor) + tail.replace(re, ", {year}");
  } else {
    console.warn("WARN: acknowledgment year not found after Date:");
  }
}

zip.file("word/document.xml", xml);
writeFileSync(outPath, zip.generate({ type: "nodebuffer" }));
console.log(`Tagged SLB template written: ${outPath}`);

// Verify: none of the original deal's values remain in visible text.
{
  const text = xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");
  for (const needle of ["Lonestar", "Venezia", "Matthews", "Gulf Fwy", "5,250", "34,500", "19,928", "4.68", "July 21", "July 28", "Margo", "2022"]) {
    if (text.includes(needle)) console.warn(`LEFTOVER: "${needle}" still present`);
  }
  console.log("Verify pass complete.");
}

// --- test render -------------------------------------------------------------------
if (testPath) {
  const now = new Date();
  const fmt = (d) =>
    d.toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "long", day: "numeric" });
  const data = {
    tel: "912-508-4170",
    sender_email: "randerson@dalfen.com",
    date: fmt(now),
    expiry_date: fmt(new Date(now.getTime() + 7 * 86400000)),
    seller_name: "Baytown Industrial LLC",
    attn: "Devon Gasaway",
    broker_firm: "Partners Real Estate",
    broker_address1: "712 Main St, Suite 2500",
    broker_address2: "Houston, TX 77002",
    property_description: "7411 Decker Dr, Baytown, TX 77520",
    price_words: "Four Million, Two Hundred Thousand",
    price: "4,200,000",
    building_sf: "5,000",
    acres: "5.06",
    lease_term_years: "5",
    // Demonstrates the per-acre basis; the app composes this from rate+basis.
    rent_phrase: "a blended base rental rate of $7,000 per usable acre per month",
    escalations: "3.5",
    deposit_words: "Fifty Thousand",
    deposit_amount: "50,000",
    dd_days: "Forty-Five (45)",
    closing_days: "Thirty (30)",
    commission_payer: "Buyer",
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
