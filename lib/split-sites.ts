// lib/split-sites.ts
//
// A deal whose address names several sites ("Gateway 190 Portfolio (1601 E
// Plano Pky + 4009 Distribution Dr + 3801 Regency Crest Dr)", "1330, 1600 &
// 1720 S Jupiter Rd") -> one street address per site, and a name for the
// package. Only a starting point: the split form shows the list for a person
// to correct before anything is created. Pure, for the test.

export function looksMultiSite(address: string | null | undefined): boolean {
  const a = String(address ?? "");
  return /\bportfolio\b/i.test(a) || /\d[^,]*\s(?:\+|&|\/)\s*\d/.test(a) || /\d+\s*,\s*\d+.*(?:&|and)\s*\d+/i.test(a) || /\(\d+\s*(?:bldgs?|buildings?|sites?)\)/i.test(a);
}

/** Street addresses in a multi-site address; [] when none are spelled out. */
export function splitSites(address: string): string[] {
  let a = address.trim();
  // "Name Portfolio (a + b + c)" -> the bracketed list.
  const inner = /\(([^)]*\d[^)]*)\)\s*$/.exec(a)?.[1];
  if (inner && !/^\d+\s*(?:bldgs?|buildings?|sites?)$/i.test(inner.trim())) a = inner;
  else if (/\bportfolio\b/i.test(a)) return [];
  const parts = a
    .split(/\s*(?:\+|\/|;)\s*/)
    .filter(Boolean)
    // "9000 Clay Rd & 9009 Pinehill Ln": two full addresses joined by "&"
    // (each side has a street name), unlike "3918 & 3920 E Jefferson St".
    .flatMap((p) => {
      const pieces = p.split(/\s+(?:&|and)\s+(?=\d)/i);
      return pieces.length > 1 && pieces.every((x) => /^\d+[A-Za-z]?(?:-\d+)?\s+[A-Za-z]/.test(x.trim())) ? pieces : [p];
    });
  const out: string[] = [];
  for (const part of parts) {
    // "1330, 1600 & 1720 S Jupiter Rd": numbers share the street at the end.
    const m = /^((?:\d+[A-Za-z]?\s*(?:,|&|and)\s*)+)(\d+[A-Za-z]?\s+.+)$/i.exec(part.trim());
    if (m) {
      const street = m[2].replace(/^\d+[A-Za-z]?\s+/, "");
      const nums = [...m[1].matchAll(/\d+[A-Za-z]?/g)].map((x) => x[0]);
      for (const n of nums) out.push(`${n} ${street}`);
      out.push(m[2]);
    } else if (/^\d/.test(part.trim())) {
      out.push(part.trim());
    }
  }
  return [...new Set(out.map((s) => s.replace(/\s+/g, " ").trim()))];
}

/** "Gateway 190 Portfolio (…)" -> "Gateway 190 Portfolio"; otherwise "<first site> portfolio". */
export function portfolioName(address: string, sites: string[]): string {
  const head = address.replace(/\s*\(.*$/, "").trim();
  if (/\bportfolio\b/i.test(head)) return head.slice(0, 120);
  return `${sites[0] ?? head} portfolio`.slice(0, 120);
}
