export interface CfoTask {
  title: string;
  due_date: string | null;
  status: string;
}

export function isCallForOffersTask(task: Pick<CfoTask, "title">): boolean {
  const title = task.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return /^(?:call for offers?|cfo)(?: |$)/.test(title);
}

/** Round 1 is the initial call for offers; 2 is best & final; 3+ are numbered. */
export function offerRoundLabel(round: number | null | undefined): string {
  const r = Math.max(1, Number(round) || 1);
  return r === 1 ? "Call for offers" : r === 2 ? "Best & final" : `Round ${r}`;
}

/** Label for the button that opens the round after `round`. */
export function nextRoundAction(round: number | null | undefined): string {
  const next = Math.max(1, Number(round) || 1) + 1;
  return next === 2 ? "Call for best & final" : `Start round ${next}`;
}

// Existing CFO dates live in follow-up tasks. Read them directly so edits,
// completion and deletion are reflected everywhere without copying dates.
// Keep the later standalone column as a fallback for explicitly entered dates.
// From round 2 on, the column holds that round's due date and wins: a stale
// round-1 task left open must not put the old deadline back on the tile.
export function callForOffersDate(deal: {
  tasks?: CfoTask[] | null;
  call_for_offers_on?: string | null;
  offer_round?: number | null;
}): string | null {
  if ((deal.offer_round ?? 1) > 1 && deal.call_for_offers_on) return deal.call_for_offers_on;
  const dates = (deal.tasks ?? [])
    .filter(t => t.status === "open" && t.due_date && isCallForOffersTask(t))
    .map(t => t.due_date!)
    .sort();
  return dates[0] ?? deal.call_for_offers_on ?? null;
}
