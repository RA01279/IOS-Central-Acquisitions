// lib/agents/comp-import.ts
//
// The "comp-import" agent: read a PDF comp sheet (text extracted in the
// browser) and return its transactions as two tab-separated tables, one of
// leases and one of sales, under the column headers Hopper's comp parser
// already understands. The tables then go through the same parser as a pasted
// broker table, so units, dates and rent bases are handled in one place and
// the person reviews the rows exactly as they would any other import. The
// agent only DRAFTS; nothing is saved from its output.

export const LEASE_COLUMNS = [
  "Address", "City", "State", "Market", "Submarket", "Project Name", "Suite", "Tenant", "Landlord",
  "Commencement", "Term Months", "Rate (AC/Mo)", "Rate Annual", "Rate Monthly", "Total Monthly",
  "Lease Type", "Free Rent", "TI", "Escalations", "Building SF", "Acres", "Yard Acres", "Notes",
] as const;

export const SALE_COLUMNS = [
  "Address", "City", "State", "Market", "Submarket", "Project Name", "Sale Price", "Sale Date",
  "Buyer", "Seller", "Cap Rate", "Building SF", "Acres", "Yard Acres", "Notes",
] as const;

export const COMP_IMPORT_INSTRUCTIONS = `Read the supplied comp sheet (text extracted from a PDF, possibly with a broker email) and extract every EXECUTED lease and CLOSED sale it reports. The report field MUST be a serialized JSON object, nothing else, with exactly this shape:
{"leases":[[cell,...],...],"sales":[[cell,...],...],"notes":[string]}
Each lease row has these cells, in this order: ${LEASE_COLUMNS.join(" | ")}
Each sale row has these cells, in this order: ${SALE_COLUMNS.join(" | ")}
Rules:
- Every cell is a string; use "" when the sheet doesn't state it. Never guess, derive or fill from general knowledge.
- One row per transaction. Skip asking rents, listings, proposals and properties with no executed lease or closed sale; mention them in notes.
- Put a lease rate in exactly ONE rate cell, the one matching how the sheet quotes it: "Rate (AC/Mo)" for $ per acre per month; "Rate Annual" for $ per building SF per year; "Rate Monthly" for $ per building SF per month; "Total Monthly" for a whole-site monthly rent. If the basis is unclear, leave all four empty and say so in notes.
- Plain numbers without $, commas or units (e.g. 8500, 0.85, 1250000). Cap Rate and Escalations as percentages (6.5 means 6.5%). Term in months. Free Rent in months. TI in $ per SF.
- Dates as YYYY-MM-DD; a month-only date as YYYY-MM. Commencement is the lease start date, Sale Date the closing date.
- State as the 2-letter code. Market is the metro (e.g. "Houston", "Dallas"), not the submarket.
- Acres = total land acres; Yard Acres only when usable yard acreage is stated separately. Building SF = total building square feet.
- Notes: flag anything a reviewer should check (conflicting figures, unclear units, rows you skipped).`;

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
