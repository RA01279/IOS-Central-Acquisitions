// lib/diligence.ts
//
// The PSA / due-diligence schedule: every deadline counted from the PSA
// effective date, with the DD length and closing period taken from the LOI
// terms (or typed in). These are starting dates -- each one is edited to match
// the signed PSA -- and the dd_end / closing rows stay in step with the deal's
// dd_end_on / closing_on, which the board and morning brief already read.
//
// No imports, so the test can load it bare.

export type TemplateMilestone = { key: string; label: string; due_on: string; sort_order: number };

export const DOC_TYPES: { value: string; label: string }[] = [
  { value: "psa", label: "PSA / amendment" },
  { value: "checklist", label: "Critical dates / closing checklist" },
  { value: "loi", label: "LOI" },
  { value: "om", label: "OM" },
  { value: "title", label: "Title commitment / exceptions" },
  { value: "survey", label: "Survey" },
  { value: "phase1", label: "Phase I ESA" },
  { value: "phase2", label: "Phase II ESA" },
  { value: "zoning", label: "Zoning letter / report" },
  { value: "property_condition", label: "Property condition report" },
  { value: "estoppel", label: "Estoppel / SNDA" },
  { value: "lease", label: "Lease" },
  { value: "appraisal", label: "Appraisal" },
  { value: "insurance", label: "Insurance" },
  { value: "excel", label: "UW model" },
  { value: "mla", label: "MLA" },
  { value: "other", label: "Other" },
];
export const DOC_TYPE_LABELS: Record<string, string> = Object.fromEntries(DOC_TYPES.map((t) => [t.value, t.label]));

// Which file type closes which milestone, so an upload can offer the link.
export const DOC_FOR_MILESTONE: Record<string, string> = {
  psa_effective: "psa",
  title_commitment: "title",
  survey: "survey",
  phase1: "phase1",
  phase2: "phase2",
  zoning: "zoning",
  estoppels: "estoppel",
};

const WORDS: Record<string, number> = {
  ten: 10, fifteen: 15, twenty: 20, "twenty-one": 21, thirty: 30, "forty-five": 45, "forty five": 45, forty: 40,
  sixty: 60, seventy: 70, "seventy-five": 75, ninety: 90, "one hundred twenty": 120,
};

/** "Sixty (60)", "60", "sixty", 45 -> a day count; null when there's no number. */
export function parseDays(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 && v <= 730 ? Math.round(v) : null;
  const s = String(v).trim().toLowerCase();
  const paren = /\((\d{1,3})\)/.exec(s)?.[1];
  const bare = /^\d{1,3}$/.test(s) ? s : null;
  const n = Number(paren ?? bare ?? NaN);
  if (Number.isFinite(n) && n > 0) return n;
  const word = Object.keys(WORDS).sort((a, b) => b.length - a.length).find((w) => s.startsWith(w));
  return word ? WORDS[word] : null;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const DEFAULT_DD_DAYS = 60;
export const DEFAULT_CLOSING_DAYS = 30;

/**
 * The standard schedule. Offsets follow the team's usual PSA: deposit within
 * 3 days, title in 15, survey / Phase I / zoning by day 30, objections 15 days
 * before DD ends, the Phase II call 10 days out, estoppels (occupied only) and
 * the extension notice in the last week, then DD expiry and closing.
 */
export function buildSchedule(input: {
  psaEffectiveOn: string;
  ddDays?: number | null;
  closingDays?: number | null;
  occupied?: boolean;
}): TemplateMilestone[] {
  const psa = input.psaEffectiveOn;
  const dd = input.ddDays && input.ddDays > 0 ? input.ddDays : DEFAULT_DD_DAYS;
  const closingDays = input.closingDays && input.closingDays > 0 ? input.closingDays : DEFAULT_CLOSING_DAYS;
  const ddEnd = addDays(psa, dd);
  // Early items never land after DD ends on a short diligence period.
  const early = (days: number) => (days < dd ? addDays(psa, days) : addDays(ddEnd, -1));
  const late = (daysBefore: number) => (daysBefore < dd ? addDays(ddEnd, -daysBefore) : psa);
  const rows: [string, string, string][] = [
    ["psa_effective", "PSA effective", psa],
    ["deposit", "Earnest money deposited with title", early(3)],
    ["title_commitment", "Title commitment & exception docs received", early(15)],
    ["survey", "Survey received", early(30)],
    ["phase1", "Phase I ESA received", early(30)],
    ["zoning", "Zoning verification (letter or report)", early(30)],
    ["title_objections", "Title & survey objections due", late(15)],
    ["phase2", "Phase II decision (order or waive)", late(10)],
    ...(input.occupied ? ([["estoppels", "Estoppels / SNDAs received", late(5)]] as [string, string, string][]) : []),
    ["extension", "Extension notice deadline (if extending)", late(3)],
    ["dd_end", "DD expires — deposit goes hard", ddEnd],
    ["closing", "Closing", addDays(ddEnd, closingDays)],
  ];
  return rows.map(([key, label, due_on], i) => ({ key, label, due_on, sort_order: (i + 1) * 10 }));
}

/** Open milestones due within `withinDays` (or already past), soonest first. */
export function dueSoon<T extends { due_on: string | null; done_on: string | null }>(
  rows: T[],
  today: string,
  withinDays = 7
): T[] {
  const horizon = addDays(today, withinDays);
  return rows
    .filter((r) => !r.done_on && r.due_on && r.due_on <= horizon)
    .sort((a, b) => String(a.due_on).localeCompare(String(b.due_on)));
}
