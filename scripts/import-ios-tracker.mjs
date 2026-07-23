// scripts/import-ios-tracker.mjs
// One-time import of the team's 2026 Pipeline Tracker (IOS tab) into Hopper.
//   node scripts/import-ios-tracker.mjs           -- dry run (no writes)
//   node scripts/import-ios-tracker.mjs --commit  -- actually import
//
// Mapping:
//   Evaluating -> prospect        Offered -> offered
//   Dead       -> archived (death_stage offered/prospect, reason from comments)
//   Owner -> contact (role seller); Broker Sent Through -> contact (role seller_broker)
//   Last Offer Date/Price + Times Offered -> one offers row
//   Comments + caps -> a "note" activity on the deal
//   Marketed/Off-Market -> deals.marketing_status; Type/SLB -> acquisition_type
//   Acres -> lot_sf (x 43,560); Date Entered -> deals.created_at

import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const XLSX_PATH =
  "F:\\Investments\\Acquisitions\\Live\\Acquisition\\01. Regional Admin\\SOUTH CENTRAL\\A - Market Tracking\\2026 Pipeline Tracker.xlsx";
const COMMIT = process.argv.includes("--commit");
const IMPORT_USER = "import:2026-tracker";

// -- env / client -----------------------------------------------------------
const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim().replace(/^﻿/, ""), l.slice(l.indexOf("=") + 1).trim()])
);
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// -- helpers ----------------------------------------------------------------
const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
// Dedupe key: case-insensitive, punctuation-insensitive ("Blvd." == "Blvd").
const normKey = (s) => norm(s).toLowerCase().replace(/[.,'#]/g, "");
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
}
function dateStr(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}
function cellVal(c) {
  const v = c.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.result !== undefined && v.result !== null) return v.result;
    if (v.text) return v.text;
    return ""; // unevaluated shared formulas etc.
  }
  return v;
}

const HOUSTON = ["houston", "baytown", "deer park", "tomball", "pasadena", "katy", "spring", "humble"];
const SAT = ["san antonio", "converse", "boerne", "schertz", "selma", "seguin", "new braunfels"];
function marketFor(city) {
  const c = normKey(city);
  if (!c) return null;
  if (HOUSTON.some((x) => c.includes(x))) return "Houston";
  if (SAT.some((x) => c.includes(x))) return "San Antonio";
  const DFW = ["irving", "dallas", "denton", "arlington", "fort worth", "forth worth", "garland",
    "grand prairie", "hutchins", "haltom", "seagoville", "princeton", "keller", "haslet", "plano",
    "lewisville", "mesquite", "carrollton", "farmers branch", "grapevine"];
  if (DFW.some((x) => c.includes(x))) return "DFW";
  return norm(city);
}

// -- parse ------------------------------------------------------------------
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX_PATH);
const ws = wb.worksheets.find((w) => w.name.trim().toLowerCase() === "ios");
if (!ws) { console.error("No IOS tab"); process.exit(1); }

const rows = [];
const statusTally = {};
for (let r = 6; r <= ws.rowCount; r++) {
  const row = ws.getRow(r);
  const address = norm(cellVal(row.getCell(4)));
  if (!address || /^ios offers/i.test(address) || address === "Address") continue;

  const status = normKey(cellVal(row.getCell(7)));
  statusTally[status || "(blank)"] = (statusTally[status || "(blank)"] ?? 0) + 1;

  const comments = [];
  for (let c = 21; c <= 24; c++) {
    const t = norm(cellVal(row.getCell(c)));
    if (t) comments.push(t);
  }
  const goingInCap = num(cellVal(row.getCell(18)));
  const stabYtc = norm(String(cellVal(row.getCell(19))));

  rows.push({
    excelRow: r,
    address,
    dateEntered: dateStr(cellVal(row.getCell(5))),
    city: norm(cellVal(row.getCell(6))),
    status,
    submarket: norm(cellVal(row.getCell(8))),
    lastOfferDate: dateStr(cellVal(row.getCell(9))),
    owner: norm(cellVal(row.getCell(10))),
    buildingSf: num(cellVal(row.getCell(11))),
    acres: num(cellVal(row.getCell(12))),
    lastOfferPrice: num(cellVal(row.getCell(13))),
    timesOffered: norm(String(cellVal(row.getCell(15)))),
    marketed: normKey(cellVal(row.getCell(16))),
    broker: norm(cellVal(row.getCell(17))),
    goingInCap,
    stabYtc,
    type: normKey(cellVal(row.getCell(20))), // "Type" col; also often blank
    comments,
  });
}
console.log(`Parsed ${rows.length} data rows. Status tally:`, statusTally);

// -- map to Hopper shapes -----------------------------------------------------
function mapStage(s, hasOffer) {
  // Blank status = historical rows in the tracker (the bulk of the sheet).
  // They go to the Archive so the active boards stay clean, while dedupe and
  // history still see them.
  if (!s) return { stage: "archived", death: hasOffer ? "offered" : "prospect", historical: true };
  if (s.includes("dead") || s.includes("pass")) return { stage: "archived", death: hasOffer ? "offered" : "prospect" };
  if (s.includes("offer")) return { stage: "offered" };
  if (s.includes("psa") || s.includes("contract") || s.includes("u/c") || s === "uc")
    return { stage: "moving_to_psa" };
  if (s.includes("dilig") || s === "dd") return { stage: "due_diligence" };
  if (s.includes("closed") || s.includes("acquired") || s.includes("won"))
    return { stage: "archived", death: "due_diligence", closedWon: true };
  return { stage: "prospect" }; // evaluating / unknown
}

const prepared = rows.map((x) => {
  const hasOffer = !!(x.lastOfferPrice || x.lastOfferDate);
  const m = mapStage(x.status, hasOffer);
  const commentText = x.comments.join(" | ");
  const acqType = x.type.includes("unsolicited") ? "unsolicited"
    : /\bslb\b|sale.?leaseback/i.test(commentText) || x.type.includes("slb") ? "slb"
    : x.type ? "standard" : null;
  return { ...x, ...m, hasOffer, commentText, acqType };
});

if (!COMMIT) {
  console.log("\n== DRY RUN (no writes). Sample of first 5 prepared rows ==");
  prepared.slice(0, 5).forEach((p) =>
    console.log(`${p.address} | ${p.city} -> ${marketFor(p.city)} | stage ${p.stage}${p.death ? "(died " + p.death + ")" : ""} | offer ${p.lastOfferPrice ?? "-"} | broker ${p.broker || "-"} | owner ${p.owner || "-"}`)
  );
  console.log(`\nWould import ${prepared.length} deals. Run with --commit to write.`);
  process.exit(0);
}

// -- dedupe against existing --------------------------------------------------
const { data: existingProps, error: exErr } = await supabase.from("properties").select("address");
if (exErr) throw exErr;
const existing = new Set((existingProps ?? []).map((p) => normKey(p.address)));
const toImport = prepared.filter((p) => !existing.has(normKey(p.address)));
const skipped = prepared.length - toImport.length;
console.log(`Deduped: ${skipped} rows already exist in Hopper; importing ${toImport.length}.`);

// -- contacts (owners + brokers), resolved once per unique name ---------------
const contactNames = new Set();
toImport.forEach((p) => {
  if (p.owner && p.owner.length > 1) contactNames.add(norm(p.owner));
  if (p.broker && p.broker.length > 1) contactNames.add(norm(p.broker));
});
const contactIds = new Map();
let contactsCreated = 0;
for (const name of contactNames) {
  const { data: found } = await supabase.from("contacts").select("id").ilike("name", name).limit(1).maybeSingle();
  if (found) { contactIds.set(normKey(name), found.id); continue; }
  const { data: created, error } = await supabase.from("contacts").insert({ name }).select("id").single();
  if (error) throw error;
  contactIds.set(normKey(name), created.id);
  contactsCreated++;
}
console.log(`Contacts: ${contactNames.size} unique names, ${contactsCreated} newly created.`);

// -- bulk insert properties ----------------------------------------------------
const propRows = toImport.map((p) => ({
  address: p.address,
  city: p.city || null,
  market: marketFor(p.city),
  submarket: p.submarket || null,
  asset_type: "ios",
  lot_sf: p.acres ? Math.round(p.acres * 43560) : null,
  building_sf: p.buildingSf,
}));
const { data: props, error: propErr } = await supabase.from("properties").insert(propRows).select("id");
if (propErr) throw propErr;

// -- bulk insert deals ----------------------------------------------------------
const dealRows = toImport.map((p, i) => ({
  property_id: props[i].id,
  deal_type: "acquisition",
  stage: p.stage,
  mla_status: "assumed",
  marketing_status: p.marketed.includes("off") ? "off_market" : p.marketed.includes("market") ? "marketed" : null,
  acquisition_type: p.acqType,
  death_stage: p.stage === "archived" ? p.death : null,
  death_reason: p.stage === "archived"
    ? (p.closedWon
        ? "CLOSED (acquired)"
        : p.historical
          ? "Imported: historical tracker row (no status)"
          : (p.commentText.slice(0, 120) || "Dead in tracker"))
    : null,
  created_by: IMPORT_USER,
  // Always set explicitly: PostgREST bulk inserts null (not the DB default)
  // for keys present on some rows but not others.
  created_at: (p.dateEntered ?? new Date().toISOString().slice(0, 10)) + "T12:00:00Z",
}));
const { data: deals, error: dealErr } = await supabase.from("deals").insert(dealRows).select("id");
if (dealErr) throw dealErr;

// -- offers, notes, contact links ------------------------------------------------
const offerRows = [];
const noteRows = [];
const linkRows = [];
toImport.forEach((p, i) => {
  const dealId = deals[i].id;
  if (p.hasOffer) {
    offerRows.push({
      deal_id: dealId,
      offered_at: p.lastOfferDate,
      price: p.lastOfferPrice,
      notes: `Imported from 2026 tracker${p.timesOffered ? `; times offered: ${p.timesOffered}` : ""}`,
      created_by: IMPORT_USER,
    });
  }
  const noteBits = [];
  if (p.commentText) noteBits.push(p.commentText);
  if (p.goingInCap) noteBits.push(`Going-in cap: ${p.goingInCap}`);
  if (p.stabYtc && p.stabYtc !== "0") noteBits.push(`Stabilized YTC: ${p.stabYtc}`);
  if (noteBits.length) {
    noteRows.push({
      activity_type: "note",
      subject: "Imported from 2026 Pipeline Tracker",
      body: noteBits.join(" | "),
      deal_id: dealId,
      created_by: IMPORT_USER,
    });
  }
  if (p.owner && contactIds.has(normKey(p.owner)))
    linkRows.push({ deal_id: dealId, contact_id: contactIds.get(normKey(p.owner)), role: "seller" });
  if (p.broker && contactIds.has(normKey(p.broker)))
    linkRows.push({ deal_id: dealId, contact_id: contactIds.get(normKey(p.broker)), role: "seller_broker" });
});

if (offerRows.length) {
  const { error } = await supabase.from("offers").insert(offerRows);
  if (error) throw error;
}
if (noteRows.length) {
  const { error } = await supabase.from("activities").insert(noteRows);
  if (error) throw error;
}
if (linkRows.length) {
  const { error } = await supabase.from("deal_contacts").insert(linkRows);
  if (error) throw error;
}

const byStage = {};
dealRows.forEach((d) => (byStage[d.stage] = (byStage[d.stage] ?? 0) + 1));
console.log("\n== IMPORT COMPLETE ==");
console.log(`Deals created: ${deals.length}`, byStage);
console.log(`Offers: ${offerRows.length} · Notes: ${noteRows.length} · Contact links: ${linkRows.length}`);
console.log(`Skipped as duplicates of existing Hopper deals: ${skipped}`);
