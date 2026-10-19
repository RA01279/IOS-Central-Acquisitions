// lib/contact-split.ts
//
// A "contact" that is really a broker team -- "Stephen Bailey / Dustin Volz
// (Newmark)", "Ahmed Omar (Broker), M 214.491.8068, ahmed@go-regroup.com;
// Burhaan Nadeem (Agent), ... -- GO Real Estate Group", "JLL (Mark Nicholas /
// Angela Watford)" -> the firm and one entry per person, with any email and
// phone that were typed into the name. A proposal for the Contacts clean-up
// list; a person reviews it before anything is split. Pure, for the test.

import { firmInName, tidyFirm } from "./firm-guess";

export type Person = { name: string; email: string | null; phone: string | null };
export type ContactSplit = { firm: string | null; people: Person[] };

const EMAIL = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const NOT_PERSON = /^(n\/a|na|none|tbd|local|broker|agent|broker of record|sior|ccim|vp|svp|evp|md|principal|also|inc\.?|llc|ltd\.?|team)$/i;
const FIRMISH = /\b(realty|real estate|partners|group|company|co\.?|companies|inc\.?|llc|brokerage|capital|commercial|associates|advisors|advisory|properties|investments?|services|land|cbre|jll|newmark|cushman|colliers|matthews|marcus|avison|svn|nai|transwestern|kidder|stream|bradford|holiner|bleecker|younger|lee &)\b/i;

/** Does this fragment read as a person's name ("Doc Perrier", "Mary-Kate O'Neil")? */
export function isPersonName(s: string): boolean {
  const t = s.trim();
  if (!t || NOT_PERSON.test(t) || FIRMISH.test(t)) return false;
  const words = t.split(/\s+/);
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Z][A-Za-z'’.-]*$/.test(w));
}

/** Guess which email belongs to which person: "dustin.volz@", "mseymour@", "ahmed@". */
function emailFits(email: string, name: string): boolean {
  const local = email.split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  const [first, ...rest] = name.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/);
  const last = rest[rest.length - 1] ?? "";
  return !!first && (local === first || local.includes(first + last) || local === first[0] + last || local.startsWith(first) && !!last && local.endsWith(last));
}

export function splitContact(raw: string): ContactSplit {
  let text = raw.replace(/\s+/g, " ").trim();
  // Firm: "Firm (people)" up front, or the firm written after the people.
  let firm: string | null = null;
  const lead = /^([^()/;,]+?)\s*\(([^)]+)\)\s*$/.exec(text);
  if (lead && FIRMISH.test(lead[1]) && /[\/,]|\band\b/.test(lead[2])) {
    firm = tidyFirm(lead[1]);
    text = lead[2];
  } else {
    const tail = /\s[—–]\s*(.+)$/.exec(text);
    if (tail && FIRMISH.test(tail[1].replace(EMAIL, "").replace(/\([^)]*\)/g, ""))) {
      firm = tidyFirm(tail[1].split(/\(/)[0]);
      // Contact details after the firm still belong to the people.
      // "(also Charles Strauss, Lance Young)" after the firm are people too.
      const also = /\(also\s+([^)]+)\)/i.exec(tail[1])?.[1];
      text = text.slice(0, tail.index) + " ; " + (tail[1].match(EMAIL) ?? []).join(" ") + " " + (tail[1].match(PHONE) ?? []).join(" ") + (also ? ` ; ${also}` : "");
    } else {
      const named = firmInName(text);
      if (named) {
        firm = tidyFirm(named);
        text = text.replace(new RegExp(`[,(\\s]*${named.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)?\\s*$`), "");
      }
    }
  }

  // People: chunks split on ";", then names split on "/", ",", "&", "and".
  const people: Person[] = [];
  const loose = { emails: [] as string[], phones: [] as string[] };
  for (const chunk of text.split(/\s*;\s*/)) {
    const emails = chunk.match(EMAIL) ?? [];
    // A bracket opened before a phone ("(281.664.6742, ...") isn't part of it.
    const phones = (chunk.match(PHONE) ?? []).map((x) => (x.startsWith("(") && !x.includes(")") ? x.slice(1) : x).trim());
    const fragments = chunk
      .replace(EMAIL, " ")
      .replace(PHONE, " ")
      .replace(/\((?:also\s+)?([^)]*)\)/gi, (_, inner) => (/[A-Z][a-z]+\s[A-Z]/.test(inner) && !/broker|agent|record|local/i.test(inner) ? `, ${inner}` : " "))
      .replace(/\b[MOC]\b\s*(?=,|$)/g, " ")
      .split(/\s*(?:\/|,|&|\band\b|\s[—–-]\s)\s*/)
      .map((s) => s.replace(/^[\s:,-]+|[\s:,-]+$/g, "").replace(/\s+/g, " "));
    // A firm sitting among the names: "Nathan Wynne / CBRE National Partners".
    if (!firm) {
      const f = fragments.find((x) => FIRMISH.test(x) && !isPersonName(x));
      if (f) firm = tidyFirm(f);
    }
    const names = fragments.filter(isPersonName);
    if (!names.length) { loose.emails.push(...emails); loose.phones.push(...phones); continue; }
    const before = people.length;
    for (const n of names) if (!people.some((p) => p.name.toLowerCase() === n.toLowerCase())) people.push({ name: n, email: null, phone: null });
    const added = people.slice(before);
    for (const e of emails) (added.find((p) => !p.email && emailFits(e, p.name)) ?? (added.length === 1 && !added[0].email ? added[0] : null))?.email != null || assign(added, e, "email");
    if (added.length === 1 && phones[0]) added[0].phone = phones[0];
  }
  // Details that stood apart from any name ("— Newmark (dustin.volz@nmrk.com, 972...)").
  for (const e of loose.emails) assign(people, e, "email");
  if (loose.phones[0]) { const p = people.find((x) => x.email && loose.emails.includes(x.email)) ?? (people.length === 1 ? people[0] : null); if (p && !p.phone) p.phone = loose.phones[0]; }
  return { firm, people };

  function assign(list: Person[], email: string, _: "email") {
    const p = list.find((x) => !x.email && emailFits(email, x.name)) ?? (list.length === 1 && !list[0].email ? list[0] : null);
    if (p) p.email = email;
    return true;
  }
}
