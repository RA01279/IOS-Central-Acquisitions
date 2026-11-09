// lib/broker-match.ts
//
// Turns whatever was typed or imported as "the broker" into people, and finds
// each one in the contact book. Every place a broker lands on a deal (New
// Deal, OM / email import, portfolio import, the deal's Contacts panel) goes
// through here, so a broker is saved once and every deal they bring hangs off
// that one contact -- which is what the broker scorecard counts.
//
//   parseBrokers("Jane Smith & Tom Ruiz, CBRE")  -> two people at CBRE
//   matchBroker(person, contacts)                 -> exact match, or close ones
//
// "Exact" (same email, or same name at the same firm / no firm on either side)
// links without asking. "Close" (Jim vs James Smith, a one-letter typo, the
// same name at a different firm) is shown as "Did you mean ...?" and a person
// decides -- nothing is merged silently. Pure, for the test.

import { splitContact } from "./contact-split";
import { firmInName, tidyFirm } from "./firm-guess";

export type BrokerInput = { name: string; firm: string | null; email: string | null; phone: string | null };

export type BrokerCandidate = {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  company_id: string | null;
  company_name: string | null;
};

export type BrokerMatch = { input: BrokerInput; exact: BrokerCandidate | null; close: BrokerCandidate[] };

const EMAIL = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;

/** One or more brokers from free text: "Jane Smith, CBRE", "Smith / Ruiz (JLL)", "jane@cbre.com". */
export function parseBrokers(raw: string | null | undefined): BrokerInput[] {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const split = splitContact(text);
  const firm = split.firm ? tidyFirm(split.firm) : null;
  if (split.people.length) {
    return split.people.map((p) => ({ name: p.name, firm, email: p.email?.toLowerCase() ?? null, phone: p.phone }));
  }
  // Not a recognisable "First Last" (one word, lower case, a nickname...):
  // keep what was typed as the name, minus any firm, email or phone in it.
  const email = text.match(EMAIL)?.[0]?.toLowerCase() ?? null;
  const phone = text.match(PHONE)?.[0]?.trim() ?? null;
  const named = firmInName(text);
  let name = text.replace(EMAIL, " ").replace(PHONE, " ");
  if (named) name = name.replace(new RegExp(`[,(\\s—–-]*${named.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)?\\s*$`, "i"), "");
  name = name.replace(/[\s,;:()—–-]+$/g, "").replace(/^[\s,;:()—–-]+/g, "").replace(/\s+/g, " ").trim();
  if (!name) {
    // Only a firm ("CBRE") or only an email: the firm stands in as the name so
    // the deal still records who sent it.
    if (!email && (firm || named)) return [{ name: tidyFirm(firm ?? named!), firm: tidyFirm(firm ?? named!), email: null, phone }];
    name = email ? email.split("@")[0] : text;
  }
  return [{ name, firm: firm ?? (named ? tidyFirm(named) : null), email, phone }];
}

// -- Matching ---------------------------------------------------------------

const SUFFIX = /^(jr|sr|ii|iii|iv|sior|ccim|cpa|mba|esq)$/;

/** "James T. Smith, Jr." -> ["james", "smith"]: lower case, no initials or suffixes. */
function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !SUFFIX.test(w));
}

const normFirm = (s: string | null | undefined) => (s ? tidyFirm(s).toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim() : "");

// Common short forms, each group one person's possible first names.
const NICKNAMES = [
  "james jim jimmy jamie", "william bill billy will willy liam", "robert bob bobby rob robbie bert", "michael mike mikey mick",
  "christopher chris kit", "matthew matt matty", "david dave davey", "daniel dan danny", "thomas tom tommy",
  "joseph joe joey", "stephen steven steve stevie", "anthony tony", "andrew andy drew", "nicholas nick nicky",
  "benjamin ben benny", "samuel sam sammy", "alexander alex al", "katherine catherine kathryn kate katie kathy cathy kat",
  "elizabeth liz beth betsy lizzie eliza", "jennifer jen jenny", "richard rick ricky rich dick", "edward ed eddie ted ned",
  "gregory greg", "jeffrey geoffrey jeff", "jonathan jon jonny", "john jack johnny", "charles charlie chuck chas",
  "patrick pat paddy", "patricia pat patty trish", "timothy tim timmy", "joshua josh", "zachary zach zack",
  "jacob jake", "nathan nathaniel nate", "kenneth ken kenny", "ronald ron ronnie", "donald don donnie", "lawrence larry",
  "gerald jerry", "susan sue suzy", "margaret meg maggie peggy", "deborah debra deb debbie", "rebecca becky becca",
  "victoria vicki tori", "frederick fred freddie", "douglas doug", "raymond ray", "gary garrett", "philip phillip phil",
  "abigail abby", "allison alison ally", "alexandra alex lexi", "christina christine chris tina", "jessica jess jessie",
  "cynthia cindy", "pamela pam", "barbara barb", "theodore ted teddy theo", "harold hal harry", "henry hank harry",
  "bradley brad", "bradford brad", "mitchell mitch", "russell russ", "randall randy", "stanley stan", "leonard len lenny",
];
const NICK = new Map<string, Set<string>>();
for (const group of NICKNAMES) {
  const names = group.split(" ");
  for (const n of names) {
    if (!NICK.has(n)) NICK.set(n, new Set());
    for (const o of names) NICK.get(n)!.add(o);
  }
}

/** Could these be the same person's first name? Jim/James, Chris/Christopher, J/John. */
function firstNamesFit(a: string, b: string): boolean {
  if (a === b) return true;
  if (NICK.get(a)?.has(b)) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short);
}

/** Edit distance, capped: anything past `max` returns max + 1. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * A contact's own name and firm. Older contacts were saved with the firm in
 * the name ("Jane Smith, CBRE") -- read those as Jane Smith at CBRE.
 */
function candidateParts(c: BrokerCandidate): { words: string[]; firm: string } {
  const people = splitContact(c.name).people;
  const name = people.length === 1 ? people[0].name : c.name;
  return { words: nameWords(name), firm: normFirm(c.company_name ?? firmInName(c.name)) };
}

export function matchBroker(input: BrokerInput, candidates: BrokerCandidate[]): BrokerMatch {
  const email = input.email?.toLowerCase() ?? null;
  if (email) {
    const byEmail = candidates.find((c) => c.email?.toLowerCase() === email);
    if (byEmail) return { input, exact: byEmail, close: [] };
  }
  const words = nameWords(input.name);
  const firm = normFirm(input.firm);
  if (!words.length) return { input, exact: null, close: [] };
  const full = words.join(" ");
  const first = words[0];
  const last = words[words.length - 1];

  const sameName: BrokerCandidate[] = [];
  const close: { c: BrokerCandidate; score: number }[] = [];
  for (const c of candidates) {
    const p = candidateParts(c);
    if (!p.words.length) continue;
    const firmsAgree = !firm || !p.firm || p.firm === firm;
    const cFull = p.words.join(" ");
    if (cFull === full) {
      if (firmsAgree) sameName.push(c);
      // Same name, different firm: maybe they moved, maybe a namesake. Ask.
      else close.push({ c, score: 1 });
      continue;
    }
    const cFirst = p.words[0];
    const cLast = p.words[p.words.length - 1];
    let score = 0;
    if (words.length > 1 && p.words.length > 1 && cLast === last && firstNamesFit(first, cFirst)) score = 3;
    else if (full.length >= 8 && distance(full, cFull, 2) <= 2) score = 2;
    else if (words.length > 1 && p.words.length > 1 && cFirst === first && distance(last, cLast, 1) <= 1 && last.length >= 4) score = 2;
    if (!score) continue;
    // A broker at a different firm is less likely the same person.
    close.push({ c, score: score + (firm && p.firm === firm ? 2 : firmsAgree ? 0 : -1) });
  }

  // One person by that name at that firm (or nobody's firm known): link it.
  // Two "John Smith"s and no firm to tell them apart: ask.
  if (sameName.length === 1) return { input, exact: sameName[0], close: [] };
  const sameNameAtFirm = firm ? sameName.filter((c) => candidateParts(c).firm === firm) : [];
  if (sameNameAtFirm.length === 1) return { input, exact: sameNameAtFirm[0], close: [] };
  for (const c of sameName) close.push({ c, score: 5 });

  close.sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name));
  const seen = new Set<string>();
  const list = close.filter(({ c }) => !seen.has(c.id) && seen.add(c.id)).slice(0, 5).map(({ c }) => c);
  return { input, exact: null, close: list };
}

/** A broker on its way to a deal: a contact already picked, or a person to save. */
export type BrokerEntry = { contactId: string } | { name: string; firm?: string | null; email?: string | null; phone?: string | null };

/** What a broker field holds for display: "Jane Smith (CBRE), Tom Ruiz". */
export function brokerLabel(entries: { name: string; firm?: string | null }[]): string {
  return entries.map((e) => (e.firm && e.firm.toLowerCase() !== e.name.toLowerCase() ? `${e.name} (${e.firm})` : e.name)).join(", ");
}
