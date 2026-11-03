export interface CfoTask {
  title: string;
  due_date: string | null;
  status: string;
}

export function isCallForOffersTask(task: Pick<CfoTask, "title">): boolean {
  const title = task.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return /^(?:call for offers?|cfo)(?: |$)/.test(title);
}

// Existing CFO dates live in follow-up tasks. Read them directly so edits,
// completion and deletion are reflected everywhere without copying dates.
// Keep the later standalone column as a fallback for explicitly entered dates.
export function callForOffersDate(deal: { tasks?: CfoTask[] | null; call_for_offers_on?: string | null }): string | null {
  const dates = (deal.tasks ?? [])
    .filter(t => t.status === "open" && t.due_date && isCallForOffersTask(t))
    .map(t => t.due_date!)
    .sort();
  return dates[0] ?? deal.call_for_offers_on ?? null;
}
