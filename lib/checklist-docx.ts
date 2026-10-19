// lib/checklist-docx.ts
//
// Reads a counsel's "Critical Dates and Closing Checklist" (Word .docx) into
// the deal's diligence schedule and closing checklist. The format, from the
// team's PSA counsel:
//   - a heading block: seller, purchaser, property, "Real Estate Contract
//     dated <date>", the purchase price;
//   - a two-column table, Date | Action, one row per critical date, the action
//     citing contract sections ("Earnest Money Deposit Due [within 3 BDs ...]
//     ($35,000.00; Sec. 1.7)");
//   - a closing checklist table, Document | Responsible Party | Signatories |
//     Status, grouped under section rows (TRANSACTION DOCUMENTS, PURCHASER'S
//     DELIVERIES, ...).
// Pure: takes word/document.xml text, so the test can feed it the real file.

export type CriticalDate = {
  /** Template milestone this row is, when it is one (lib/diligence.ts keys). */
  key: string | null;
  label: string;
  due_on: string | null;
  /** Bracketed rule, section cites and any further paragraphs. */
  notes: string | null;
};
export type ChecklistItem = {
  section: string;
  item: string;
  responsible: string | null;
  signatories: string | null;
  status: string | null;
  done: boolean;
};
export type ChecklistDoc = {
  property: string | null;
  contractDate: string | null;
  price: number | null;
  dates: CriticalDate[];
  checklist: ChecklistItem[];
};

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const paraText = (p: string) => decode(p.replace(/<w:tab\/>/g, " ").replace(/<w:br\/>/g, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
/** A cell as its paragraphs (empty ones dropped). */
const cellParas = (tc: string) => (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(paraText).filter(Boolean);

function tables(xml: string): string[][][] {
  return (xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? []).map((t) =>
    (t.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []).map((tr) => (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((tc) => cellParas(tc).join("\n")))
  );
}

const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};
/** "10/19/2026", "10/19/26", "October 19, 2026" -> ISO; null otherwise. */
export function parseDate(s: string): string | null {
  const a = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (a) {
    const y = Number(a[3]) < 100 ? 2000 + Number(a[3]) : Number(a[3]);
    return iso(y, Number(a[1]), Number(a[2]));
  }
  const b = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i.exec(s);
  return b ? iso(Number(b[3]), MONTHS[b[1].toLowerCase()], Number(b[2])) : null;
}

// First match wins, so the combined "Inspection Period/Title Review" row is
// the DD expiry, not the title objection date.
const KEYS: [RegExp, string][] = [
  [/\beffective date\b/i, "psa_effective"],
  [/\bearnest money|\bdeposit\b/i, "deposit"],
  [/\b(inspection|due diligence|feasibility|study) period\b/i, "dd_end"],
  [/\bestoppel/i, "estoppels"],
  [/\bclosing date\b|^closing\b/i, "closing"],
  [/\btitle (objection|review)|\bsurvey objection/i, "title_objections"],
  [/\bextension\b/i, "extension"],
  [/\bphase ii\b/i, "phase2"],
  [/\bphase i\b/i, "phase1"],
  [/\bsurvey\b/i, "survey"],
  [/\btitle commitment\b/i, "title_commitment"],
  [/\bzoning\b/i, "zoning"],
];

/** "Earnest Money Deposit Due [within 3 BDs ...] ($35,000.00; Sec. 1.7)" -> label + the rest. */
function splitAction(text: string): { label: string; rest: string | null } {
  const [first, ...more] = text.split("\n");
  const cut = first.search(/\s*[\[(]/);
  const label = (cut > 0 ? first.slice(0, cut) : first).trim().slice(0, 200);
  const rest = [cut > 0 ? first.slice(cut).trim() : "", ...more].filter(Boolean).join("\n").trim();
  return { label: label || first.slice(0, 200), rest: rest ? rest.slice(0, 2000) : null };
}

const DONE = /^(executed|delivered|received|complete[d]?|done|signed|approved|waived|n\/a)\b/i;

export function parseChecklistDocx(xml: string): ChecklistDoc {
  const body = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, "");
  const lines = (body.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(paraText).filter(Boolean);
  const head = lines.slice(0, 15).join("\n");
  const priceMatch = /\$\s?([\d,]{4,}(?:\.\d{2})?)/.exec(head);
  const contractLine = lines.find((l) => /\bcontract\b.*\bdated\b/i.test(l)) ?? null;
  const property = lines.find((l) => /\d+\s+\S+.*\b(property|road|rd|street|st|drive|dr|blvd|hwy|lane|ln|way|ave(nue)?|tx|texas)\b/i.test(l) && !/\bLLC\b|\bL\.?P\.?\b|“/.test(l)) ?? null;

  const dates: CriticalDate[] = [];
  const checklist: ChecklistItem[] = [];
  for (const t of tables(xml)) {
    const header = (t[0] ?? []).map((c) => c.toLowerCase());
    if (header.some((h) => /^date\b/.test(h)) && header.some((h) => /action|event|deadline|description/.test(h))) {
      const dCol = header.findIndex((h) => /^date\b/.test(h));
      const aCol = header.findIndex((h) => /action|event|deadline|description/.test(h));
      for (const row of t.slice(1)) {
        const action = (row[aCol] ?? "").trim();
        if (!action) continue;
        const { label, rest } = splitAction(action);
        const key = KEYS.find(([re]) => re.test(label))?.[1] ?? null;
        dates.push({ key, label, due_on: parseDate(row[dCol] ?? ""), notes: rest });
      }
      continue;
    }
    const docCol = header.findIndex((h) => /\bdocument|\bitem\b|deliverable/.test(h));
    if (docCol >= 0 && header.some((h) => /status/.test(h))) {
      const col = (re: RegExp) => header.findIndex((h) => re.test(h));
      const rCol = col(/responsib/), sCol = col(/signator/), stCol = col(/status/);
      let section = "General";
      for (const row of t.slice(1)) {
        const item = (row[docCol] ?? "").trim();
        const others = row.filter((_, i) => i !== docCol).map((c) => c.trim()).filter(Boolean);
        if (!item) continue;
        // A section row: an all-caps label and nothing in the other columns.
        if (!others.length && item === item.toUpperCase() && /[A-Z]/.test(item)) {
          section = item.replace(/\s+/g, " ").replace(/^\W+|\W+$/g, "").replace(/\b([A-Z])([A-Z’']+)/g, (_, a, b) => a + b.toLowerCase());
          continue;
        }
        const status = stCol >= 0 ? (row[stCol] ?? "").trim() || null : null;
        checklist.push({
          section,
          item: item.replace(/\n/g, "; ").slice(0, 300),
          responsible: rCol >= 0 ? (row[rCol] ?? "").trim().replace(/\n/g, " / ") || null : null,
          signatories: sCol >= 0 ? (row[sCol] ?? "").trim().replace(/\n/g, " / ") || null : null,
          status: status ? status.replace(/\n/g, " ").slice(0, 200) : null,
          done: !!status && DONE.test(status),
        });
      }
    }
  }
  return {
    property,
    contractDate: contractLine ? parseDate(contractLine) : null,
    price: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null,
    dates,
    checklist,
  };
}
