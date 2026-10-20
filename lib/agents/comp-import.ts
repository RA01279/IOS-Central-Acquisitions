// lib/agents/comp-import.ts
//
// The "comp-import" agent: read broker comp material -- a PDF comp sheet, an
// email body, a table pasted from Outlook or Excel (text extracted in the
// browser) -- and return its transactions as two tab-separated tables, one of
// leases and one of sales, under the column headers Hopper's comp parser
// already understands. The tables then go through the same parser as a pasted
// broker table, so units, dates and rent bases are handled in one place and
// the person reviews the rows exactly as they would any other import. The
// agent only DRAFTS; nothing is saved from its output.

export const LEASE_COLUMNS = [
  "Address", "City", "State", "Market", "Submarket", "Project Name", "Suite", "Tenant", "Landlord",
  "Commencement", "Expiration", "Term Months", "Rate (AC/Mo)", "Rate Annual", "Rate Monthly", "Total Monthly",
  "Lease Type", "Free Rent", "TI", "Escalations", "Building SF", "Acres", "Yard Acres", "Notes",
] as const;

export const SALE_COLUMNS = [
  "Address", "City", "State", "Market", "Submarket", "Project Name", "Sale Price", "Sale Date",
  "Buyer", "Seller", "Cap Rate", "Building SF", "Acres", "Yard Acres", "Notes",
] as const;

export const COMP_IMPORT_INSTRUCTIONS = `Read the supplied broker comp material -- a PDF comp sheet, an email body, or a table pasted from Outlook, Excel or a website -- and extract every EXECUTED lease and CLOSED sale it reports. The text may be messy: table cells separated by tabs or pipes, cells wrapped onto several lines, a column header row far above its data, merged cells, a comp described in a sentence ("Acme signed 5 yrs on 4.2 ac at 123 Main at $7,500/ac/mo NNN starting March"), or one property block per comp ("Address: ... / Rate: ... / Size: ..."). Work out which value belongs to which comp from the layout as a whole, not line by line. The report field MUST be a serialized JSON object, nothing else, with exactly this shape:
{"leases":[[cell,...],...],"sales":[[cell,...],...],"notes":[string]}
Each lease row has these cells, in this order: ${LEASE_COLUMNS.join(" | ")}
Each sale row has these cells, in this order: ${SALE_COLUMNS.join(" | ")}
Rules:
- Every cell is a string; use "" when the sheet doesn't state it. Never guess, derive or fill from general knowledge.
- One row per transaction. Skip asking rents, listings, proposals and properties with no executed lease or closed sale; mention them in notes.
- Put a lease rate in exactly ONE rate cell, the one matching how the sheet quotes it: "Rate (AC/Mo)" for $ per acre per month; "Rate Annual" for $ per building SF per year; "Rate Monthly" for $ per building SF per month; "Total Monthly" for a whole-site monthly rent. Read the basis from the unit next to the number or in the column header: "/AC/MO", "per acre", "PAM" = per acre per month; "PSF/YR", "/SF/YR", "NNN $/SF" with values like 6.00-15.00 = annual per SF; "/SF/MO", "PSF/MO" with values like 0.40-1.50 = monthly per SF; "$/MO", "per month" with a five- or six-figure number and no SF or acre unit = total monthly. An annual whole-site rent ("$96,000/yr") goes in Total Monthly divided by 12. If the basis is truly unclear, leave all four empty and say so in notes -- never guess the basis.
- A range ("$0.85-$0.95/SF/mo", "$7,500 escalating to $8,200") takes the starting figure; put the rest in Notes. "Starting rate" is the rate.
- Plain numbers without $, commas or units (e.g. 8500, 0.85, 1250000). "$1.2M" = 1200000; "125K" = 125000. Cap Rate and Escalations as percentages (6.5 means 6.5%; "3% annual bumps" = 3). Term in months ("5 yrs" = 60, "62 mo" = 62). Free Rent in months. TI in $ per SF.
- Sizes: "SF", "RSF", "Bldg SF" = Building SF; "AC", "acres", "land" = Acres; land given in square feet ("217,800 SF land", "Lot SF") converts to Acres at 43,560 SF per acre. Never put land SF in Building SF.
- Dates as YYYY-MM-DD; a month-only date as YYYY-MM; a quarter ("Q2 2025") as its first month (2025-04); a year alone as YYYY. Commencement is the lease start (or signed date if that is all there is -- say so in Notes); Expiration the lease end when stated; Sale Date the closing date. Two-digit years are 20xx.
- Address: the street address only (number and street), without suite, city or ZIP; put the suite in Suite and the city and state in their cells. When a comp is named only by a park or building name, put that name in Project Name and Address.
- State as the 2-letter code. Market is the metro (e.g. "Houston", "Dallas"), not the submarket.
- Acres = total land acres; Yard Acres only when usable yard acreage is stated separately. Building SF = total building square feet.
- Offering memorandum pages: extract only the broker's comparable transactions (lease comps, sale comps, land sales). NEVER the subject property itself -- not its rent roll, in-place or pro forma rents, asking or guidance price, or projections -- even when the page presents them in a table. If a comp table mixes in the subject, skip that row and say so in notes.
- A sale with "Land" or no building is still a sale; leave Building SF "". A sale's price per SF or per acre alone (no total) goes in Notes with Sale Price "" unless the size is stated so the total is the stated rate times the stated size -- then fill Sale Price and say so in Notes.
- Before answering, check every row: each lease has a rate in exactly one rate cell or a note why not; the counts of leases and sales match what the material reports; no row repeats.
- Notes: flag anything a reviewer should check (conflicting figures, unclear units, rows you skipped, values you converted).`;

const cell = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "").replace(/[\t\r\n]+/g, " ").trim();

function table(columns: readonly string[], rows: unknown): string | null {
  if (!Array.isArray(rows)) return null;
  const body = rows
    .filter((r): r is unknown[] => Array.isArray(r))
    .slice(0, 500)
    .map((r) => columns.map((_, i) => cell(r[i])))
    .filter((r) => r[0]); // an address is the least a row needs
  return body.length ? [columns.join("\t"), ...body.map((r) => r.join("\t"))].join("\n") : null;
}

export interface CompImport {
  /** Tab-separated, header row first; null when there were none. */
  leases: string | null;
  sales: string | null;
  notes: string[];
}

/** Strict parse of the agent's report; null when it isn't the contract. */
export function parseCompImport(report: string): CompImport | null {
  let raw: any;
  try {
    raw = JSON.parse(report.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || (!Array.isArray(raw.leases) && !Array.isArray(raw.sales))) return null;
  return {
    leases: table(LEASE_COLUMNS, raw.leases),
    sales: table(SALE_COLUMNS, raw.sales),
    notes: Array.isArray(raw.notes) ? raw.notes.filter((n: unknown) => typeof n === "string").slice(0, 10).map((n: string) => n.slice(0, 400)) : [],
  };
}
