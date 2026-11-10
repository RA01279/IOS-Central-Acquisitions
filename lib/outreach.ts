// lib/outreach.ts
//
// Off-market owner outreach: the vocabulary (how we reached out, what came of
// it), the quick follow-up choices, and where a prospect stands -- read off
// its touches, never stored separately, so it can't drift. Pure; the DB side
// is lib/outreach-db.ts.

export const TOUCH_TYPES = ["call", "email", "letter", "text", "site_visit", "meeting"] as const;
export type TouchType = (typeof TOUCH_TYPES)[number];
export const TOUCH_LABELS: Record<string, string> = {
  call: "Call", email: "Email", letter: "Letter / mailer", text: "Text", site_visit: "Drive-by / visit", meeting: "Meeting",
};

export const OUTCOMES = ["no_answer", "left_message", "spoke", "interested", "not_now", "not_selling", "wrong_contact"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABELS: Record<string, string> = {
  no_answer: "No answer",
  left_message: "Left a message",
  spoke: "Spoke with owner",
  interested: "Interested in selling",
  not_now: "Not now, maybe later",
  not_selling: "Not selling",
  wrong_contact: "Wrong contact",
};

/** Quick follow-up choices, in days from today. */
export const FOLLOW_UPS: { label: string; days: number }[] = [
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 91 },
  { label: "6 months", days: 182 },
];

export type OutreachStatus = "new" | "reaching_out" | "talking" | "interested" | "later" | "not_selling" | "bad_contact";
export const STATUS_LABELS: Record<OutreachStatus, string> = {
  new: "Not contacted",
  reaching_out: "Reaching out",
  talking: "In conversation",
  interested: "Interested",
  later: "Not now",
  not_selling: "Not selling",
  bad_contact: "Need contact",
};
/** Badge tone for each status (hopper.css badge2 classes). */
export const STATUS_TONE: Record<OutreachStatus, string> = {
  new: "neutral", reaching_out: "brand", talking: "brand", interested: "success", later: "warning", not_selling: "danger", bad_contact: "warning",
};

export type Touch = { activity_type: string; outcome: string | null; occurred_at: string };

/**
 * Where outreach stands, from the touches (newest first). The latest touch
 * with an outcome decides, except that once an owner has spoken to us a later
 * unanswered call doesn't drop them back to "reaching out".
 */
export function outreachStatus(touches: Touch[]): OutreachStatus {
  const withOutcome = touches.filter((t) => t.outcome);
  if (!touches.length) return "new";
  const latest = withOutcome[0]?.outcome;
  if (latest === "interested") return "interested";
  if (latest === "not_selling") return "not_selling";
  if (latest === "not_now") return "later";
  if (latest === "wrong_contact") return "bad_contact";
  if (latest === "spoke") return "talking";
  if (withOutcome.some((t) => t.outcome === "spoke" || t.outcome === "interested")) return "talking";
  return "reaching_out";
}

/** Today + n days, as YYYY-MM-DD (dates only; no time zone drift). */
export function addDays(today: string, n: number): string {
  return new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

/** Request body -> a valid touch, or the reason it isn't one. */
export function parseTouch(body: any, today: string):
  | { ok: true; type: TouchType; outcome: Outcome | null; note: string | null; occurredOn: string; nextOn: string | null; contactId: string | null }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Expected a JSON body" };
  if (!(TOUCH_TYPES as readonly string[]).includes(body.type)) return { ok: false, error: "Pick how you reached out." };
  const outcome = body.outcome == null || body.outcome === "" ? null : body.outcome;
  if (outcome !== null && !(OUTCOMES as readonly string[]).includes(outcome)) return { ok: false, error: "Unknown outcome." };
  const date = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
  const occurredOn = body.occurredOn == null || body.occurredOn === "" ? today : body.occurredOn;
  if (!date(occurredOn) || occurredOn > today) return { ok: false, error: "The touch date can't be in the future." };
  const nextOn = body.nextOn == null || body.nextOn === "" ? null : body.nextOn;
  if (nextOn !== null && (!date(nextOn) || nextOn < today)) return { ok: false, error: "Pick a follow-up date from today on." };
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 4000) : null;
  const contactId = typeof body.contactId === "string" && /^[0-9a-f-]{36}$/i.test(body.contactId) ? body.contactId : null;
  return { ok: true, type: body.type, outcome, note, occurredOn, nextOn, contactId };
}
