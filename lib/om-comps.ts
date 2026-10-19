// lib/om-comps.ts
//
// Finding the comps inside an offering memorandum. An OM is mostly the
// subject property -- its own rent roll, asking price, pro forma -- with the
// broker's lease and sale comparables on a few pages. Only those pages (and
// the page after each, where a comp table usually continues) go to the
// comp-import agent, which keeps the subject's own numbers out of the comp
// database and keeps a 60-page OM inside the agent's input budget.
//
// No imports, so the test can load it bare.

export const OM_COMP_PAGE = /\b(comparables?|comps?\b|lease comp|sales? comp|rent comp|recent (?:leases?|sales?|transactions?)|market (?:leases?|sales?|transactions?)|land sales?|precedent transactions?)\b/i;
const MAX_CHARS = 90000;

export type OmPage = { page: number; text: string };

/** Split pdfText() output ("\n[Page N] ...") into pages. */
export function splitPages(text: string): OmPage[] {
  const out: OmPage[] = [];
  const re = /\[Page (\d+)\]\s?/g;
  const marks = [...text.matchAll(re)];
  marks.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index! : text.length;
    out.push({ page: Number(m[1]), text: text.slice(start, end).trim() });
  });
  return out;
}

/**
 * The comparables pages of an OM, with their page markers, ready for the
 * agent. `found` is false when no page mentions comps -- the caller should
 * then say the OM has none rather than send the whole document.
 */
export function compPages(text: string): { text: string; pages: number[]; found: boolean } {
  const pages = splitPages(text);
  const hit = new Set<number>();
  pages.forEach((p, i) => {
    if (OM_COMP_PAGE.test(p.text)) {
      hit.add(i);
      if (i + 1 < pages.length) hit.add(i + 1);
    }
  });
  const chosen = [...hit].sort((a, b) => a - b).map((i) => pages[i]);
  let out = "";
  const used: number[] = [];
  for (const p of chosen) {
    const block = `\n[Page ${p.page}] ${p.text}`;
    if (out.length + block.length > MAX_CHARS) break;
    out += block;
    used.push(p.page);
  }
  return { text: out.trim(), pages: used, found: used.length > 0 };
}

/** What the agent is told this document is (it reads the rules in its instructions). */
export function omCompSource(fileName: string, text: string): string {
  return `OFFERING MEMORANDUM COMPARABLES (${fileName}). Pages from an OM's lease and sale comparables sections:\n${text}`;
}
