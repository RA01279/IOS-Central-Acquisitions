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
  // sale
  salePrice: number | null;
  closedOn: string | null;
  capRate: number | null;
  datePrecision: DatePrecision;
  /** The $/SF the broker quoted, kept to cross-check our own maths. */
  quotedPsf: number | null;
  warnings: string[];
}

export interface ParseResult {
  comps: ParsedComp[];
  /** Problems with the paste as a whole, not with one row. */
  warnings: string[];
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
  | "leaseDate" | "capRate" | "city" | "market" | "submarket" | "tenant" | "notes";

// Header aliases, matched on letters only so punctuation, case, and typos in
// spacing don't matter. "addres" is in there because that is genuinely how the
// header arrived in a real broker email -- misspelled.
const HEADER_ALIASES: [RegExp, Field][] = [
  [/^(address|addres|adress|property|site|location)$/, "address"],
  [/^(yearbuilt|yrbuilt|built|vintage|year)$/, "yearBuilt"],
  [/^(sf|buildingsf|bldgsf|buildingarea|size|squarefeet|buildingsize|gla)$/, "buildingSf"],
  [/^(ac|acres|acreage|landac|siteacres|landacres)$/, "acres"],
  [/^(landsf|lotsf|sitesf|landarea)$/, "lotSf"],
  [/^(coverage|coverageratio|bldgcoverage|far)$/, "coverage"],
  [/^(saledate|closedate|closingdate|dateclosed|datesold|sold)$/, "saleDate"],
  [/^(saleprice|price|purchaseprice|consideration|salesprice)$/, "salePrice"],
  [/^(psf|pricesf|persf|pricepersf|ppsf|rentsf|baserentsf|rate)$/, "psf"],
  [/^(leasetype|type|structure|leasestructure)$/, "leaseType"],
  [/^(monthlybase|monthlyrent|baserent|monthlybaserent|rent|monthly)$/, "monthlyRent"],
  [/^(leasedate|commenced|commencement|datecommenced|startdate|leasestart|executed)$/, "leaseDate"],
  [/^(caprate|cap|yield)$/, "capRate"],
  [/^(city|municipality)$/, "city"],
  [/^(market|metro)$/, "market"],
  [/^(submarket|subarea)$/, "submarket"],
  [/^(tenant|tenantname|lessee)$/, "tenant"],
  [/^(notes|comments|remarks)$/, "notes"],
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
function splitRow(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  if (line.includes("|")) return line.split("|").map((c) => c.trim());
  if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map((c) => c.trim());
  return [line.trim()];
}

/**
 * Everything below the first quoted-reply marker is an older message. Comp
 * tables from previous emails in the thread would otherwise be re-imported
 * every time someone replies.
 */
function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l) =>
    /^\s*(from|sent|to|cc|subject)\s*:/i.test(l) ||
    /^\s*-{3,}\s*original message/i.test(l) ||
    /^\s*_{5,}\s*$/.test(l) ||
    /^\s*on .+ wrote:\s*$/i.test(l)
  );
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
export function htmlToDelimitedText(html: string): string {
  return (
    html
      // Drop anything that isn't content before touching structure. Outlook
      // signatures carry <style> blocks and tracking images.
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      // Cell and row boundaries become delimiters the row parser understands.
      .replace(/<\/t[dh]\s*>\s*<t[dh][^>]*>/gi, " | ")
      .replace(/<\/tr\s*>/gi, "\n")
      .replace(/<\/(table|p|div|h[1-6])\s*>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      // Entities after tag removal, so a &lt;table&gt; written as literal text
      // can't be mistaken for markup and re-parsed as structure.
      .replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, decodeEntity)
      .replace(/[ \t]+/g, " ")
      .split("\n")
      .map((l) => l.replace(/\s*\|\s*/g, " | ").trim())
      .filter(Boolean)
      .join("\n")
  );
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
  /** Used when the headers don't reveal whether a table is lease or sale. */
  defaultCompType?: CompType;
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
      // Headers reveal the type more reliably than surrounding prose.
      if (asFields.includes("saleDate") || asFields.includes("salePrice")) tableType = "sale";
      else if (asFields.includes("leaseType") || asFields.includes("monthlyRent")) tableType = "lease";
      continue;
    }

    if (!mapping) continue; // data before any header -- nothing to map it to

    const get = (f: Field): string | undefined => {
      const i = mapping!.indexOf(f);
      return i === -1 ? undefined : cells[i];
    };

    const address = (get("address") ?? cells[0] ?? "").trim();
    if (!address || num(address) !== null) continue; // blank or a totals row

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
      city: (get("city") ?? opts.city) || null,
      market: (get("market") ?? opts.market) || null,
      submarket: (get("submarket") ?? opts.submarket) || null,
      yearBuilt: num(get("yearBuilt")),
      buildingSf,
      lotSf,
      acres: acres ?? (lotSfDirect !== null ? Number((lotSfDirect / SQFT_PER_ACRE).toFixed(2)) : null),
      coveragePct,
      rent: null,
      rentBasis: null,
      leaseType: leaseTypeFrom(get("leaseType")),
      dateCommenced: null,
      salePrice: null,
      closedOn: null,
      capRate: pct(get("capRate")),
      datePrecision: "day",
      quotedPsf,
      warnings: rowWarnings,
    };

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
      const monthly = num(get("monthlyRent"));
      if (monthly !== null) {
        parsed.rent = monthly;
        parsed.rentBasis = "total_monthly";
      } else if (quotedPsf !== null) {
        parsed.rent = quotedPsf;
        parsed.rentBasis = "per_sf_bldg_monthly";
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
      // Lease comps need a commencement date to satisfy the DB constraint, and
      // broker tables often omit it entirely.
      if (!parsed.dateCommenced) rowWarnings.push("No lease commencement date — required before saving");
    }

    comps.push(parsed);
    rowsInTable++;
  }

  if (!comps.length) {
    warnings.push(
      "No comp rows recognised. Paste the table including its header row (Address, SF, AC, Price...)."
    );
  }
  return { comps, warnings };
}
