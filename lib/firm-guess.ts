// lib/firm-guess.ts
//
// Suggests a brokerage for a contact that has none, from what's already
// written on the contact: the firm in brackets or after a dash or comma in
// the name ("Stephen Bailey (Newmark)", "Mike T -- Caldwell Land Co"), an
// existing company named inside it, or the email domain (nmrk.com ->
// Newmark). Only a suggestion -- the broker scorecard shows it for a person
// to confirm. Pure, so the test can feed it names.

export type FirmGuess = { companyId: string | null; name: string; why: string } | null;

// Brokerage email domains -> the firm as it's usually written.
const DOMAINS: Record<string, string> = {
  "nmrk.com": "Newmark", "ngkf.com": "Newmark", "cbre.com": "CBRE", "jll.com": "JLL", "am.jll.com": "JLL",
  "cushwake.com": "Cushman & Wakefield", "colliers.com": "Colliers", "avisonyoung.com": "Avison Young",
  "marcusmillichap.com": "Marcus & Millichap", "matthews.com": "Matthews", "lee-associates.com": "Lee & Associates",
  "naipartners.com": "NAI Partners", "streamrealty.com": "Stream Realty", "transwestern.com": "Transwestern",
  "kiddermathews.com": "Kidder Mathews", "svn.com": "SVN", "bradfordco.com": "Bradford", "caldwellcos.com": "Caldwell Companies",
  "partnersrealestate.com": "Partners Real Estate", "youngerpartners.com": "Younger Partners", "holinergroup.com": "Holiner",
  "davidsonbogel.com": "Davidson Bogel", "richyoungco.com": "Rich Young Co.", "go-regroup.com": "GO Real Estate Group",
};
const PERSONAL = /^(gmail|yahoo|aol|outlook|hotmail|icloud|me|msn|live|comcast|att|sbcglobal)\./i;
// Words that make a trailing fragment a firm rather than a title or a person.
const FIRMISH = /\b(realty|real estate|partners|group|company|co\.?|companies|inc\.?|llc|brokerage|capital|commercial|associates|advisors|properties|investments?|services|land|cbre|jll|newmark|cushman|colliers|matthews|marcus|avison|svn|nai|transwestern|kidder|stream|bradford|holiner|lee &)\b/i;
const NOT_FIRM = /^(sior|ccim|vp|svp|evp|md|principal|broker|agent|local|also\b.*|inc\.?|llc|ltd\.?)$/i;

const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9&]+/g, " ").replace(/\s+/g, " ").trim();

/** The part of a contact's name that names a firm, if any. */
export function firmInName(name: string): string | null {
  const candidates = [
    /\(([^)]+)\)\s*$/.exec(name)?.[1],
    /\s[—–-]{1,2}\s*([^—–-]+)$/.exec(name)?.[1],
    /,\s*([^,]+)$/.exec(name)?.[1],
  ];
  for (const c of candidates) {
    const t = c ? tidyFirm(c) : "";
    if (t && !NOT_FIRM.test(t) && FIRMISH.test(t) && !t.includes("/")) return t;
  }
  return null;
}

// The big brokerages, however a contact wrote them, under one name each --
// so "CBRE, Inc." and "CBRE" don't become two firms.
const BRANDS: [RegExp, string][] = [
  [/\bcbre\b/i, "CBRE"], [/\bjll\b|jones lang/i, "JLL"], [/\bnewmark|\bngkf\b/i, "Newmark"],
  [/\bcushman/i, "Cushman & Wakefield"], [/\bcolliers\b/i, "Colliers"], [/\bavison young\b/i, "Avison Young"],
  [/\bmarcus\s*&\s*millichap\b/i, "Marcus & Millichap"], [/\bmatthews\b/i, "Matthews"], [/\btranswestern\b/i, "Transwestern"],
  [/\blee\s*&\s*associates\b/i, "Lee & Associates"], [/\bstream realty\b/i, "Stream Realty Partners"],
];

/** A firm fragment cleaned up: no emails, phones, legal suffixes or stray punctuation. */
export function tidyFirm(raw: string): string {
  const t = raw
    .replace(/\([^)]*\)/g, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/\+?\d[\d().\s-]{6,}\d/g, " ")
    .replace(/,?\s*\b(inc|llc|l\.l\.c|ltd|lp|l\.p)\.?(?=[\s,]|$)/gi, "")
    .replace(/[,;+]+/g, " ")
    .replace(/^[\s—–-]+|[\s—–-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return BRANDS.find(([re]) => re.test(t))?.[1] ?? t;
}

export function guessFirm(contact: { name: string; email?: string | null }, companies: { id: string; name: string }[]): FirmGuess {
  const n = ` ${norm(contact.name)} `;
  // 1. An existing company named in the contact (longest name first, so
  //    "Stream Realty Partners" beats "Partners").
  const byLength = [...companies].sort((a, b) => norm(b.name).length - norm(a.name).length);
  for (const c of byLength) {
    const cn = norm(c.name);
    if (cn.length >= 3 && n.includes(` ${cn} `)) return { companyId: c.id, name: c.name, why: "named in the contact" };
  }
  // 2. A firm written into the name.
  const written = firmInName(contact.name);
  if (written) {
    const existing = companies.find((c) => norm(c.name) === norm(written) || norm(c.name).startsWith(`${norm(written)} `));
    return existing ? { companyId: existing.id, name: existing.name, why: "named in the contact" } : { companyId: null, name: written, why: "named in the contact" };
  }
  // 3. The email domain -- in the email field or pasted into the name.
  const emails = [contact.email ?? "", ...(contact.name.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [])].filter(Boolean);
  for (const e of emails) {
    const domain = e.split("@")[1]?.toLowerCase();
    if (!domain || PERSONAL.test(domain)) continue;
    const firm = DOMAINS[domain];
    if (firm) {
      const existing = companies.find((c) => norm(c.name).startsWith(norm(firm)));
      return { companyId: existing?.id ?? null, name: existing?.name ?? firm, why: `email domain ${domain}` };
    }
  }
  return null;
}
