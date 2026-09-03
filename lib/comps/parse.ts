// lib/comps/parse.ts
//
// Parses comps out of pasted broker text -- the tables brokers put in the body
// of an email, which arrive as tab- or pipe-delimited text when copied out of
// Outlook, Excel, or a PDF.
//
// Deliberately deterministic, not an LLM call. Real comp emails (see
// 0021_comp_fields_from_broker_emails.sql) are tabular with a header row, and a
// parser that can be unit-tested against known input is worth more here than
// one that is usually right: these numbers end up in an underwriting
// recommendation. Free-prose comps ("just traded 5 acres on Rankin at ~$5.50")
// are a separate problem and would want a model; this handles the tables.
//
// Everything it produces is a DRAFT. Nothing here writes to the repository
// directly -- the caller reviews first.

export type CompType = "lease" | "sale";
export type DatePrecision = "day" | "month" | "quarter" | "year";

export interface ParsedComp {
  compType: CompType;
  address: string;
  /** Building or park name, where a street address alone isn't unique. */
  projectName: string | null;
  /** Suite or unit, for one tenancy inside a multi-tenant building. */
  suite: string | null;
  /** CAM recovery, $/SF/year, so NNN and gross rents stay comparable. */
  camPsfAnnual: number | null;
  /** True when dateCommenced was derived rather than stated. */
  dateEstimated: boolean;
  city: string | null;
  market: string | null;
  submarket: string | null;
  yearBuilt: number | null;
  buildingSf: number | null;
  lotSf: number | null;
  acres: number | null;
  coveragePct: number | null;
  // lease
  rent: number | null;
  rentBasis: string | null;
  leaseType: string | null;
  dateCommenced: string | null;
  tenantName: string | null;
  landlordName: string | null;
  leaseTermMonths: number | null;
  leaseExpiresOn: string | null;
  escalationsPct: number | null;
  freeRentMonths: number | null;
  tiPsf: number | null;
  listingBroker: string | null;
  // sale
  salePrice: number | null;
  closedOn: string | null;
  capRate: number | null;
  noi: number | null;
  buyer: string | null;
  seller: string | null;
  saleBroker: string | null;
  // site
  clearHeightFt: number | null;
  officeSf: number | null;
  yardAcres: number | null;
  trailerStalls: number | null;
  dockHighDoors: number | null;
  gradeLevelDoors: number | null;
  surfaceType: string | null;
  zoning: string | null;
  notes: string | null;
  datePrecision: DatePrecision;
  /** The $/SF the broker quoted, kept to cross-check our own maths. */
  quotedPsf: number | null;
  warnings: string[];
}

export interface ParseResult {
  comps: ParsedComp[];
  /** Problems with the paste as a whole, not with one row. */
  warnings: string[];
  /**
   * What the parser actually saw, after flattening. Shown in the UI when
   * nothing parses, because "no comp rows recognised" on its own is a dead end
   * -- with this you can see whether the table arrived at all, whether it was
   * shattered, or whether the header just wasn't recognised.
   */
  seen?: { lines: string[]; totalLines: number; headerCandidates: string[] };
}

const SQFT_PER_ACRE = 43560;

// -- scalar parsing -------------------------------------------------------

// Brokers write "±9,900", "$1,485,000", "16.40%", and "—" for unknown. Anything
// that isn't a number becomes null rather than 0: a zero rent would quietly
// drag a recommendation down, a null is visibly missing.
function num(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = String(raw).trim();
  if (!s || /^[—–-]+$/.test(s) || /^(n\/?a|tbd|unknown)$/i.test(s)) return null;
  const cleaned = s.replace(/[±~$,\s]/g, "").replace(/%$/, "");
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Percentages arrive as "16.40%" or "0.164" or "16.4" -- normalise to a fraction. */
function pct(raw: string | undefined): number | null {
  const n = num(raw);
  if (n === null) return null;
  const hadSign = /%/.test(String(raw));
  // 16.4 means 16.4%; 0.164 already is one. Coverage above 1 is impossible as a
  // fraction, so anything >1 is being quoted in percent.
  const fraction = hadSign || n > 1 ? n / 100 : n;
  // Rounded because dividing by 100 in binary floating point turns 16.40% into
  // 0.16399999999999998, which then displays and compares badly. Six places is
  // far more precision than a coverage ratio or cap rate carries.
  return Number(fraction.toFixed(6));
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Comp dates are rarely full dates. "Jan 2026" is the norm, and pretending it
 * means the 1st with day precision would let downstream code treat a guess as
 * exact -- so the precision travels with the value.
 */
export function parseCompDate(raw: string | undefined): { date: string; precision: DatePrecision } | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || /^[—–-]+$/.test(s)) return null;

  // Q1 2026
  const q = s.match(/^Q([1-4])\s*[-/ ]?\s*(\d{4})$/i);
  if (q) {
    const month = (Number(q[1]) - 1) * 3 + 1;
    return { date: `${q[2]}-${String(month).padStart(2, "0")}-01`, precision: "quarter" };
  }
  // Jan 2026 / January 2026 / Jan-26
  const my = s.match(/^([A-Za-z]{3,9})\.?\s*[-/ ]?\s*(\d{2,4})$/);
  if (my) {
    const m = MONTHS[my[1].slice(0, 4).toLowerCase()] ?? MONTHS[my[1].slice(0, 3).toLowerCase()];
    if (m) {
      let y = Number(my[2]);
      if (y < 100) y += y > 70 ? 1900 : 2000;
      return { date: `${y}-${String(m).padStart(2, "0")}-01`, precision: "month" };
    }
  }
  // 1/15/2026 or 2026-01-15
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return {
      date: `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`,
      precision: "day",
    };
  }
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    let y = Number(us[3]);
    if (y < 100) y += y > 70 ? 1900 : 2000;
    return {
      date: `${y}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`,
      precision: "day",
    };
  }
  // 2026
  const yr = s.match(/^(19|20)\d{2}$/);
  if (yr) return { date: `${s}-01-01`, precision: "year" };

  return null;
}

function leaseTypeFrom(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/[^a-z]/g, "");
  if (!s || s === "na") return null;
  if (s.includes("nnn") || s.includes("triplenet")) return "nnn";
  if (s.includes("absolute")) return "absolute_net";
  if (s.includes("industrialgross") || s === "ig") return "industrial_gross";
  if (s.includes("modified") || s === "mg") return "modified_gross";
  if (s.includes("gross")) return "gross";
  return "other";
}

// -- column mapping -------------------------------------------------------

type Field =
  | "address" | "yearBuilt" | "buildingSf" | "acres" | "lotSf" | "coverage"
  | "saleDate" | "salePrice" | "psf" | "leaseType" | "monthlyRent"
  | "leaseDate" | "capRate" | "city" | "market" | "submarket" | "tenant" | "notes"
  | "landlord" | "termMonths" | "clearHeight" | "officeSf" | "yardAcres"
  | "trailerStalls" | "dockDoors" | "gradeDoors" | "surfaceType" | "zoning"
  | "escalations" | "freeRent" | "tiPsf" | "noi" | "buyer" | "seller"
  | "broker" | "leaseExpiry" | "rateAnnual" | "rateMonthly" | "projectName"
  | "suite" | "camMonthly" | "camPsfAnnual" | "totalMonthly";

// Header aliases, matched on letters only so punctuation, case, and typos in
// spacing don't matter. "addres" is in there because that is genuinely how the
// header arrived in a real broker email -- misspelled.
const HEADER_ALIASES: [RegExp, Field][] = [
  // "propertyaddress" and "streetaddress" matter: without them the address is
  // only found by the "first column" fallback, which works right up until a
  // broker's sheet puts something else first.
  [/^(address|addres|adress|property|site|location|propertyaddress|streetaddress|propertyname|siteaddress)$/, "address"],
  [/^(yearbuilt|yrbuilt|built|vintage|year)$/, "yearBuilt"],
  [/^(sf|buildingsf|bldgsf|buildingarea|size|squarefeet|squarefootage|buildingsize|gla|rba|totalsf)$/, "buildingSf"],
  [/^(ac|acres|acreage|landac|siteacres|landacres)$/, "acres"],
  [/^(landsf|lotsf|sitesf|landarea)$/, "lotSf"],
  [/^(coverage|coverageratio|bldgcoverage|far)$/, "coverage"],
  [/^(saledate|closedate|closingdate|dateclosed|datesold|sold)$/, "saleDate"],
  [/^(saleprice|price|purchaseprice|consideration|salesprice|salepricedollars|saleprice\$)$/, "salePrice"],
  [/^(psf|pricesf|persf|pricepersf|ppsf|rentsf|baserentsf|rate|pricepsf|rentpsf|salepricepsf|salepricesf|psfmo|persfmo)$/, "psf"],
  // Rate columns that declare their own basis. Handled as distinct fields
  // rather than aliases of "psf", because the basis is the whole point: an
  // annual $13.20 and a monthly $1.10 are the same rent, and treating either
  // as the other is off by 12x.
  [/^(startingrateannual|annualrate|rateannual|baserentannual|annualbaserent|rentannual)$/, "rateAnnual"],
  [/^(startingratemonthly|monthlyrate|ratemonthly|baserentmonthly|monthlybaserent)$/, "rateMonthly"],
  [/^(leasetype|type|structure|leasestructure)$/, "leaseType"],
  [/^(monthlybase|monthlyrent|baserent|monthlybaserent|rent|monthly)$/, "monthlyRent"],
  [/^(leasedate|commenced|commencement|datecommenced|startdate|leasestart|executed)$/, "leaseDate"],
  [/^(caprate|cap|yield)$/, "capRate"],
  // Distinguishes buildings that share a street address ("Pine Crossing
  // Business Park - Bldg. C" vs "- Bldg. D"), which is what stops one of them
  // being dropped as a duplicate.
  [/^(projectname|project|buildingname|park|development|propertyname2)$/, "projectName"],
  [/^(city|municipality)$/, "city"],
  [/^(market|metro)$/, "market"],
  [/^(submarket|subarea)$/, "submarket"],
  [/^(tenant|tenantname|lessee|occupant)$/, "tenant"],
  [/^(notes|comments|remarks)$/, "notes"],
  [/^(landlord|landlordname|lessor|owner)$/, "landlord"],
  [/^(term|termmonths|leaseterm|termmos|months)$/, "termMonths"],
  [/^(clearheight|clear|clearht|height|ceilingheight)$/, "clearHeight"],
  [/^(officesf|office|officearea)$/, "officeSf"],
  [/^(yardacres|yardac|usableacres|usableac|yard)$/, "yardAcres"],
  [/^(trailerstalls|trailerparking|trailers|stalls)$/, "trailerStalls"],
  [/^(dockdoors|dockhigh|docks|dh|dockhighdoors)$/, "dockDoors"],
  [/^(gradedoors|gradelevel|driveins|gl|gradeleveldoors)$/, "gradeDoors"],
  [/^(surface|surfacetype|yardsurface|paving)$/, "surfaceType"],
  [/^(zoning|zone)$/, "zoning"],
  [/^(escalations|escalation|bumps|annualincrease)$/, "escalations"],
  [/^(freerent|freerentmonths|abatement)$/, "freeRent"],
  [/^(ti|tipsf|tiallowance|tenantimprovement)$/, "tiPsf"],
  [/^(noi|netoperatingincome)$/, "noi"],
  [/^(buyer|purchaser|grantee|buyercompanyname|buyername)$/, "buyer"],
  [/^(seller|grantor|vendor|sellercompanyname|sellername)$/, "seller"],
  [/^(broker|listingbroker|agent|brokerage)$/, "broker"],
  [/^(leaseexpiry|expiration|expires|expiry|leaseend|expirationdate|leaseexpiration)$/, "leaseExpiry"],
  [/^(commencementdate|datecommencement|rentstart|rentcommencement)$/, "leaseDate"],
  // Rent rolls: the tenancy identifier, the monthly base rent, and the CAM
  // recovery. "baserentmo" is how "Base Rent / Mo" reduces once punctuation is
  // stripped, and its absence is why a real rent roll imported with no rent.
  [/^(suite|ste|unit|space|bay|suiteunit)$/, "suite"],
  [/^(baserentmo|baserentmonth|monthlybaserentmo|rentmo|baserentpermonth)$/, "monthlyRent"],
  [/^(rentsfyr|rentpsfyr|rentsfyear|baserentsfyr|annualrentsf|rentperssfyr)$/, "rateAnnual"],
  [/^(rentsfmo|rentpsfmo|rentsfmonth|baserentsfmo)$/, "rateMonthly"],
  // CAM, split by unit for the same reason rents are: "CAM / Mo" is dollars a
  // month, "CAM $/SF/Yr" is a rate, and averaging one as the other is
  // meaningless. A bare "CAM" column is treated as monthly dollars, which is
  // the rent-roll convention.
  [/^(cammo|cammonth|campermonth|camrecoverymo|cam|camrent)$/, "camMonthly"],
  [/^(camsfyr|campsfyr|camsfyear|campersfyr|nnnpsf|nnnsfyr|opexpsf|opexsfyr)$/, "camPsfAnnual"],
  [/^(totalmonthly|grossmonthly|totalrentmo|totalrentmonthly)$/, "totalMonthly"],
];

/**
 * Clear height, which is never written as a bare number: 28', 28 FT, 28'0",
 * 24-28'. A range is resolved to its LOWER bound -- clear height is a
 * constraint, and what fits under the lowest point is what actually fits.
 *
 * Kept separate from num() rather than teaching it to strip quote marks,
 * because num() also decides whether a cell is a number at all and an
 * apostrophe is meaningful elsewhere.
 */
function feet(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = String(raw).trim();
  if (!s || /^[—–-]+$/.test(s)) return null;
  const range = s.match(/^(\d+(?:\.\d+)?)\s*(?:['"]|ft\.?|feet)?\s*[-–to]+\s*(\d+(?:\.\d+)?)/i);
  if (range) return Math.min(Number(range[1]), Number(range[2]));
  const single = s.match(/^(\d+(?:\.\d+)?)/);
  if (!single) return null;
  const n = Number(single[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Surface as brokers write it -> the stored enum.
function surfaceFrom(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (!s.trim() || /^[—–-]+$/.test(s)) return null;
  if (/concrete|conc\b/.test(s)) return "concrete";
  if (/asphalt|paved/.test(s)) return "asphalt";
  if (/crushed|caliche|millings/.test(s)) return "crushed_stone";
  if (/gravel/.test(s)) return "gravel";
  if (/dirt|native|grass/.test(s)) return "dirt";
  if (/mixed|partial/.test(s)) return "mixed";
  if (/unimproved|raw/.test(s)) return "unimproved";
  return null;
}

// Columns that can only belong to one kind of comp. Deliberately excludes
// saleDate/closeDate: brokers put a "Close Date" on lease tabs to mean the date
// the deal was signed, so it says nothing about which kind of table this is.
const SALE_SIGNALS: Field[] = ["salePrice", "capRate", "noi", "buyer", "seller"];
const LEASE_SIGNALS: Field[] = [
  "rateAnnual", "rateMonthly", "monthlyRent", "leaseType", "termMonths",
  "leaseExpiry", "tenant", "landlord", "leaseDate", "freeRent", "tiPsf",
];

function fieldFor(header: string): Field | null {
  const key = header.toLowerCase().replace(/[^a-z]/g, "");
  for (const [re, field] of HEADER_ALIASES) if (re.test(key)) return field;
  return null;
}

// -- row splitting --------------------------------------------------------

// Pasted tables arrive tab-delimited (Outlook/Excel), pipe-delimited (already
// flattened), or column-aligned with runs of spaces. Tabs and pipes are
// unambiguous; the multi-space fallback is last because street addresses
// contain single spaces.
// Rows that look like data but aren't. Every one of these came from a real
// file: a rent roll's "TOTAL | 9 units · 100% leased | 51700" and a data
// tape's "Total/Average" both imported as comps before this existed.
const TOTALS_ROW =
  /^(total|totals|subtotal|sub-total|grand total|average|avg|weighted avg|weighted average|total\/average)\b/i;

// Section titles that end the current table. A rent roll continues past its
// tenant list into "ANNUALIZED SUMMARY", "LEASE EXPIRATION SCHEDULE" and
// "NOTES" -- and the expiration schedule is itself a table whose header the
// parser will happily adopt, then import rows whose first column is a DATE as
// though it were an address.
const SECTION_BREAK =
  /^(annualized summary|annual summary|lease expiration schedule|expiration schedule|rollover schedule|notes|assumptions|disclaimer|source[s]?:)\b/i;

/**
 * Shift an ISO date by whole months, clamping the day so subtracting a term
 * from "2030-05-31" can't roll into the following month.
 */
export function shiftMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Does this cell read as a date rather than an address? */
function looksLikeDate(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return (
    /^\d{4}-\d{1,2}-\d{1,2}$/.test(t) ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t) ||
    /^[A-Za-z]{3,9}\.?\s+\d{2,4}$/.test(t) ||
    /^Q[1-4]\s*\d{4}$/i.test(t)
  );
}

function splitRow(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  if (line.includes("|")) return line.split("|").map((c) => c.trim());
  if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map((c) => c.trim());
  return [line.trim()];
}

const HEADER_LINE = /^\s*(from|sent|to|cc|bcc|subject|date|importance|attachments|reply-to)\s*:/i;
const QUOTE_MARKER = [
  /^\s*-{3,}\s*(original message|forwarded message)/i,
  /^\s*_{5,}\s*$/,
  /^\s*on .{4,}\s+wrote:\s*$/i,
  /^\s*>{1,}\s?/,
];

/**
 * Everything below a quoted-reply marker is an older message, and comp tables
 * from earlier in the thread would otherwise be re-imported on every reply.
 *
 * The subtlety: selecting a whole message in Outlook's reading pane copies its
 * OWN header block first ("From: Doc Perrier / Sent: ... / To: ... / Subject:
 * ..."). Treating the first "From:" as a quote boundary therefore discarded the
 * entire email and produced "no comp rows recognised" on a perfectly good
 * paste. So a header block is only a boundary once real content has been seen
 * before it -- a header block at the very top belongs to the message itself.
 */
function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  let seenContent = false;
  let cut = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    if (QUOTE_MARKER.some((re) => re.test(line))) {
      cut = i;
      break;
    }
    if (HEADER_LINE.test(line)) {
      // A header block only ends the live message if something preceded it.
      if (seenContent) {
        cut = i;
        break;
      }
      continue; // the message's own headers -- skip, don't cut
    }
    // Outlook's external-sender banner isn't content; it sits above the body
    // and would otherwise make the message's own header block look quoted.
    if (/^\s*EXTERNAL\b/i.test(line) || /originated outside of/i.test(line)) continue;
    seenContent = true;
  }

  return cut === -1 ? text : lines.slice(0, cut).join("\n");
}

// -- HTML input -----------------------------------------------------------

// Entities that turn up in broker email tables. "plusmn" is the important one
// -- Outlook writes the ± before every measurement as &plusmn;, and leaving it
// encoded made every SF and acreage unparseable.
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  mdash: "—", ndash: "–", plusmn: "±", deg: "°", times: "×",
  sup2: "²", frac12: "½", frac14: "¼", frac34: "¾", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};

/**
 * Decode one HTML entity. Done in a single pass over the text rather than a
 * chain of .replace() calls, because a chain that expands &amp; before &lt;
 * turns the literal text "&amp;lt;" into "<" -- decoding its own output.
 */
function decodeEntity(match: string, body: string): string {
  if (body.startsWith("#x") || body.startsWith("#X")) {
    const code = parseInt(body.slice(2), 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  }
  if (body.startsWith("#")) {
    const code = parseInt(body.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  }
  return NAMED_ENTITIES[body.toLowerCase()] ?? match;
}

/**
 * Flattens pasted or dropped email HTML into the pipe-delimited text the row
 * parser expects, preserving cell boundaries from the real <td> markup.
 *
 * This is the highest-fidelity path available. When an email body is copied out
 * of Outlook the clipboard carries text/html, so the actual table structure is
 * there to be read -- no guessing where one column ends and the next begins,
 * which is what delimiter sniffing has to do on the text/plain version. A
 * street address containing two spaces, or a table pasted with ragged
 * alignment, breaks the text path and not this one.
 */
/** Tags, entities and whitespace out; used for the contents of a single cell. */
function cellToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, decodeEntity)
    .replace(/\s+/g, " ")
    .trim();
}

export function htmlToDelimitedText(html: string): string {
  // Comments, styles and scripts first: Outlook signatures carry <style>
  // blocks and conditional comments full of markup that would otherwise be
  // read as content.
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");

  const out: string[] = [];
  // Walk tables and the prose between them in document order. Tables are
  // handled cell by cell rather than by a chain of replaces, because Outlook
  // wraps every cell's contents in <p class=MsoNormal> -- and turning </p>
  // into a newline (which prose needs) shatters each table row into one line
  // per cell, leaving nothing the row parser can recognise.
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(cleaned)) !== null) {
    pushProse(cleaned.slice(last, m.index));
    pushTable(m[1]);
    last = m.index + m[0].length;
  }
  pushProse(cleaned.slice(last));

  function pushProse(segment: string) {
    if (!segment) return;
    const text = segment
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, decodeEntity);
    for (const line of text.split("\n")) {
      const t = line.replace(/[ \t]+/g, " ").trim();
      if (t) out.push(t);
    }
  }

  function pushTable(inner: string) {
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let r: RegExpExecArray | null;
    let rows = 0;
    while ((r = rowRe.exec(inner)) !== null) {
      const cells: string[] = [];
      const cellRe = /<t([dh])[^>]*>([\s\S]*?)<\/t\1\s*>/gi;
      let c: RegExpExecArray | null;
      while ((c = cellRe.exec(r[1])) !== null) cells.push(cellToText(c[2]));
      // Trailing empty cells are Outlook's layout padding, not data.
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      if (cells.some((x) => x !== "")) {
        out.push(cells.join(" | "));
        rows++;
      }
    }
    // A <table> used purely for layout (signature blocks, tracking pixels)
    // yields nothing, which is correct -- it just isn't a comp table.
    if (rows === 0) pushProse(inner);
  }

  return out.join("\n");
}

/** Parse comps from an email's HTML body (clipboard text/html, .eml, .msg). */
export function parseCompHtml(html: string, opts: ParseOptions = {}): ParseResult {
  return parseCompTable(htmlToDelimitedText(html), opts);
}

/**
 * Parse whatever the drop zone or clipboard produced. Prefers HTML, since it
 * carries real cell boundaries; falls back to delimited text.
 */
export function parseCompInput(
  input: { html?: string | null; text?: string | null },
  opts: ParseOptions = {}
): ParseResult {
  if (input.html && /<t[dr]\b|<table\b/i.test(input.html)) {
    const fromHtml = parseCompHtml(input.html, opts);
    if (fromHtml.comps.length) return fromHtml;
  }
  if (input.text) return parseCompTable(input.text, opts);
  if (input.html) return parseCompHtml(input.html, opts);
  return { comps: [], warnings: ["Nothing to parse."] };
}

// -- the parser -----------------------------------------------------------

export interface ParseOptions {
  /** Applied to every comp, since broker tables carry bare street addresses. */
  city?: string | null;
  market?: string | null;
  submarket?: string | null;
  /**
   * The property every row belongs to. Required for a rent roll, whose rows
   * are suites in one building and whose address lives in the title block
   * rather than in a column.
   */
  address?: string | null;
  /** Used when the headers don't reveal whether a table is lease or sale. */
  defaultCompType?: CompType;
  /**
   * Months to subtract from a lease expiration to estimate its commencement,
   * when the rent roll gives no start date and no term. Anything derived this
   * way is flagged `dateEstimated`.
   */
  assumedTermMonths?: number | null;
  includeQuotedReply?: boolean;
}

export function parseCompTable(text: string, opts: ParseOptions = {}): ParseResult {
  const warnings: string[] = [];
  const body = opts.includeQuotedReply ? text : stripQuotedReply(text);
  if (!opts.includeQuotedReply && body.length < text.length) {
    warnings.push("Ignored quoted reply history below the first “From:” line.");
  }

  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const comps: ParsedComp[] = [];

  let mapping: (Field | null)[] | null = null;
  let tableType: CompType | null = null;
  let rowsInTable = 0;

  for (const line of lines) {
    // These section titles are TERMINAL, not merely a break. Everything after
    // them in a rent roll or a data tape is summary, and the sections have
    // their own headers that the parser will otherwise adopt as a new comp
    // table: the Oakbrook roll's "LEASE EXPIRATION SCHEDULE" is a real table
    // (Expiration | Suites | Square Feet | % of GLA | Base Rent / Mo) whose
    // eight rows imported as eight phantom comps when this only reset the
    // mapping instead of stopping.
    if (SECTION_BREAK.test(line.replace(/\s*\|\s*/g, " ").trim())) break;

    const cells = splitRow(line);
    if (cells.length < 3) {
      // Prose between tables. A line like "Here are some buildings that were
      // leased:" is the only hint that the next table changes type, so it's
      // worth reading rather than skipping.
      if (/lease[ds]?\b/i.test(line) && !/sold|sale/i.test(line)) tableType = "lease";
      else if (/sold|sale[ds]?\b/i.test(line) && !/lease/i.test(line)) tableType = "sale";
      continue;
    }

    // Is this a header row? At least two cells must map to known fields and
    // none of the first few may be numeric.
    const asFields = cells.map(fieldFor);
    const known = asFields.filter(Boolean).length;
    const looksNumeric = cells.slice(1, 4).some((c) => num(c) !== null);
    if (known >= 3 && !looksNumeric) {
      if (mapping && rowsInTable === 0) {
        warnings.push("Found a header row with no data rows beneath it.");
      }
      mapping = asFields;
      rowsInTable = 0;
      // Headers reveal the type more reliably than surrounding prose -- but by
      // WEIGHING the signals, not taking the first hit. A real lease tab led
      // with "Close Date" (the date the deal was signed), which as a lone
      // signal mistyped six lease comps as sales with no price. So a date
      // column counts for nothing on its own; only columns that can't belong
      // to the other kind of comp get a vote.
      const saleScore = asFields.filter((f) => f && SALE_SIGNALS.includes(f)).length;
      const leaseScore = asFields.filter((f) => f && LEASE_SIGNALS.includes(f)).length;
      if (saleScore > leaseScore) tableType = "sale";
      else if (leaseScore > saleScore) tableType = "lease";
      // A tie leaves whatever the prose or the caller's sheet hint established.
      continue;
    }

    if (!mapping) continue; // data before any header -- nothing to map it to

    const get = (f: Field): string | undefined => {
      const i = mapping!.indexOf(f);
      return i === -1 ? undefined : cells[i];
    };

    // A rent roll's rows are suites in ONE building, so the address comes from
    // the caller (the property the roll belongs to) and the first column is a
    // suite number. Without this the address becomes "Ste A".
    const suiteCell = get("suite")?.trim() || null;
    const address = (get("address") ?? (suiteCell ? opts.address : null) ?? opts.address ?? cells[0] ?? "").trim();

    if (!address) continue;
    if (num(address) !== null) continue; // a stray numeric first column
    // Totals and summary rows carry real-looking numbers and would otherwise
    // import as a comp with an address of "TOTAL".
    if (TOTALS_ROW.test(cells[0] ?? "") || TOTALS_ROW.test(address)) continue;
    // A date in the address column means this is a schedule, not a comp list.
    if (looksLikeDate(address)) continue;

    const rowWarnings: string[] = [];
    const compType: CompType = tableType ?? opts.defaultCompType ?? "sale";

    const buildingSf = num(get("buildingSf"));
    const acres = num(get("acres"));
    const lotSfDirect = num(get("lotSf"));
    const lotSf = lotSfDirect ?? (acres !== null ? Math.round(acres * SQFT_PER_ACRE) : null);

    let coveragePct = pct(get("coverage"));
    // Coverage is derivable, so a stated value can be checked rather than
    // trusted. A real mismatch usually means the SF and AC columns were read
    // in the wrong order.
    if (buildingSf && lotSf) {
      const computed = buildingSf / lotSf;
      if (coveragePct === null) coveragePct = Number(computed.toFixed(4));
      else if (Math.abs(computed - coveragePct) > 0.03) {
        rowWarnings.push(
          `Stated coverage ${(coveragePct * 100).toFixed(1)}% doesn't match building/land (${(computed * 100).toFixed(1)}%)`
        );
      }
    }

    const quotedPsf = num(get("psf"));
    const parsed: ParsedComp = {
      compType,
      address,
      projectName: get("projectName")?.trim() || null,
      suite: suiteCell,
      // CAM comes as either a monthly dollar amount or a $/SF/year rate, and
      // the two are told apart by their COLUMN, never by sniffing the value --
      // the same discipline as rents, for the same reason. Both normalise to
      // $/SF/year, which is how CAM is compared.
      camPsfAnnual: (() => {
        const perSf = num(get("camPsfAnnual"));
        if (perSf !== null) return perSf;
        const monthly = num(get("camMonthly"));
        if (monthly === null) return null;
        return buildingSf ? Number(((monthly * 12) / buildingSf).toFixed(4)) : null;
      })(),
      dateEstimated: false,
      // Context typed by the person importing WINS over the sheet's own
      // columns. It used to be the other way round, which meant a broker's
      // shorthand ("North", "SW") silently overrode a deliberate entry of
      // "Conroe". The sheet is the fallback, not the authority -- and where it
      // does fill in, the review table shows what each row got.
      city: (opts.city ?? get("city")) || null,
      market: (opts.market ?? get("market")) || null,
      submarket: (opts.submarket ?? get("submarket")) || null,
      yearBuilt: num(get("yearBuilt")),
      buildingSf,
      lotSf,
      acres: acres ?? (lotSfDirect !== null ? Number((lotSfDirect / SQFT_PER_ACRE).toFixed(2)) : null),
      coveragePct,
      rent: null,
      rentBasis: null,
      leaseType: leaseTypeFrom(get("leaseType")),
      dateCommenced: null,
      tenantName: get("tenant")?.trim() || null,
      landlordName: get("landlord")?.trim() || null,
      leaseTermMonths: num(get("termMonths")),
      leaseExpiresOn: parseCompDate(get("leaseExpiry"))?.date ?? null,
      escalationsPct: num(get("escalations")),
      freeRentMonths: num(get("freeRent")),
      tiPsf: num(get("tiPsf")),
      listingBroker: get("broker")?.trim() || null,
      salePrice: null,
      closedOn: null,
      capRate: pct(get("capRate")),
      noi: num(get("noi")),
      buyer: get("buyer")?.trim() || null,
      seller: get("seller")?.trim() || null,
      saleBroker: compType === "sale" ? get("broker")?.trim() || null : null,
      clearHeightFt: feet(get("clearHeight")),
      officeSf: num(get("officeSf")),
      yardAcres: num(get("yardAcres")),
      trailerStalls: num(get("trailerStalls")),
      dockHighDoors: num(get("dockDoors")),
      gradeLevelDoors: num(get("gradeDoors")),
      surfaceType: surfaceFrom(get("surfaceType")),
      zoning: get("zoning")?.trim() || null,
      notes: get("notes")?.trim() || null,
      datePrecision: "day",
      quotedPsf,
      warnings: rowWarnings,
    };

    // A term in months given without a commencement date still pins the
    // expiry once a date is filled in at review, so keep both.
    if (parsed.leaseTermMonths && parsed.leaseTermMonths > 600) {
      rowWarnings.push(`Lease term of ${parsed.leaseTermMonths} months looks like years, not months`);
    }

    if (compType === "sale") {
      parsed.salePrice = num(get("salePrice"));
      const d = parseCompDate(get("saleDate"));
      if (d) {
        parsed.closedOn = d.date;
        parsed.datePrecision = d.precision;
      }
      // The quoted $/SF is per BUILDING SF in every broker table seen so far.
      // Checking it against price/building_sf catches a misread column before
      // the comp reaches the repository.
      if (parsed.salePrice && buildingSf && quotedPsf) {
        const computed = parsed.salePrice / buildingSf;
        if (Math.abs(computed - quotedPsf) / quotedPsf > 0.05) {
          rowWarnings.push(
            `Quoted $${quotedPsf}/SF doesn't match price ÷ building SF ($${computed.toFixed(2)})`
          );
        }
      }
      if (!parsed.salePrice) rowWarnings.push("No sale price found");
      if (!parsed.closedOn) rowWarnings.push("No sale date found");
    } else {
      // Preference order matters, and it runs most-explicit first. A column
      // that names its own basis ("Starting Rate (Annual)") is unambiguous; a
      // bare "Monthly Base" is a whole-site figure; a bare "Price/SF" on a
      // lease table is per SF per month by convention. Guessing wrong here is
      // a 12x error, so an explicitly-labelled column always wins.
      const monthly = num(get("monthlyRent"));
      const rateAnnual = num(get("rateAnnual"));
      const rateMonthly = num(get("rateMonthly"));
      if (rateMonthly !== null) {
        parsed.rent = rateMonthly;
        parsed.rentBasis = "per_sf_bldg_monthly";
      } else if (rateAnnual !== null) {
        parsed.rent = rateAnnual;
        parsed.rentBasis = "per_sf_bldg_annual";
      } else if (monthly !== null) {
        parsed.rent = monthly;
        parsed.rentBasis = "total_monthly";
      } else if (quotedPsf !== null) {
        parsed.rent = quotedPsf;
        parsed.rentBasis = "per_sf_bldg_monthly";
      }
      // Both bases given: they must agree within rounding, or a column was
      // misread.
      if (rateAnnual !== null && rateMonthly !== null && rateMonthly > 0) {
        const impliedAnnual = rateMonthly * 12;
        if (Math.abs(impliedAnnual - rateAnnual) / rateAnnual > 0.05) {
          rowWarnings.push(
            `Annual rate $${rateAnnual} doesn't match monthly $${rateMonthly} x 12 ($${impliedAnnual.toFixed(2)})`
          );
        }
      }
      const d = parseCompDate(get("leaseDate"));
      if (d) {
        parsed.dateCommenced = d.date;
        parsed.datePrecision = d.precision;
      }
      if (parsed.rent !== null && monthly !== null && buildingSf && quotedPsf) {
        const computed = monthly / buildingSf;
        if (Math.abs(computed - quotedPsf) / quotedPsf > 0.05) {
          rowWarnings.push(
            `Quoted $${quotedPsf}/SF/mo doesn't match monthly rent ÷ building SF ($${computed.toFixed(2)})`
          );
        }
      }
      if (parsed.rent === null) rowWarnings.push("No rent found");

      // Dating a rent-roll lease. Rent rolls carry an expiration and usually
      // no commencement, so the start is backed into -- but only ever from
      // something real, and always flagged.
      if (!parsed.dateCommenced) {
        const expiry = parsed.leaseExpiresOn;
        const term = parsed.leaseTermMonths;
        if (expiry && term) {
          // Both known: this is arithmetic, not a guess.
          parsed.dateCommenced = shiftMonths(expiry, -term);
          parsed.datePrecision = "month";
        } else if (expiry && opts.assumedTermMonths) {
          // Expiration only. Recency is the heaviest factor in comp scoring,
          // so an assumed date must be visibly assumed -- hence the flag, the
          // coarse precision, and the warning.
          parsed.dateCommenced = shiftMonths(expiry, -opts.assumedTermMonths);
          parsed.datePrecision = "year";
          parsed.dateEstimated = true;
          rowWarnings.push(
            `Commencement estimated as ${parsed.dateCommenced} (expiry minus ${opts.assumedTermMonths} months) — no start date or term given`
          );
        }
      }
      if (!parsed.dateCommenced) {
        rowWarnings.push("No lease commencement date — required before saving");
      }
    }

    comps.push(parsed);
    rowsInTable++;
  }

  if (!comps.length) {
    // Say WHY, not just that it failed. The three causes look identical from
    // the outside and need different fixes.
    const multiCell = lines.filter((l) => splitRow(l).length >= 3);
    if (!lines.length) {
      warnings.push(
        "Nothing left to read after removing quoted reply history. Try selecting just the comp table rather than the whole thread."
      );
    } else if (!multiCell.length) {
      warnings.push(
        "Found text but no table — every line came through as a single column. If you pasted from a PDF or plain-text email, the columns are lost; paste from the email's formatted body or drop the spreadsheet instead."
      );
    } else {
      warnings.push(
        `Found ${multiCell.length} table row${multiCell.length === 1 ? "" : "s"} but no header row I recognised. The header needs a column named Address, plus at least two of: SF, AC, Coverage, Sale Date, Price, Lease Type, Monthly Base.`
      );
    }
    return {
      comps,
      warnings,
      seen: {
        lines: multiCell.length ? multiCell.slice(0, 12) : lines.slice(0, 12),
        totalLines: lines.length,
        // Rows that look like headers, to show which names went unrecognised.
        headerCandidates: multiCell
          .filter((l) => splitRow(l).every((c) => num(c) === null))
          .slice(0, 3),
      },
    };
  }
  return { comps, warnings };
}
