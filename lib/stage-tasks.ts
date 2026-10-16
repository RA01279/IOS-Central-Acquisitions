// lib/stage-tasks.ts
//
// The checklist a deal picks up when it enters a stage: each item becomes an
// open task on the deal, assigned to the deal's owner (or whoever moved it),
// due a few days out. Titles already open on the deal are skipped, so moving a
// deal back and forward again doesn't stack duplicates.
//
// Diligence DEADLINES live on the Diligence tab (deal_milestones); these are
// the to-dos that get those deadlines met.

export type StageTask = { title: string; dueInDays: number };

export const STAGE_TASKS: Record<string, StageTask[]> = {
  uw: [
    { title: "Finish underwriting and review comps", dueInDays: 5 },
    { title: "Set the IC date", dueInDays: 5 },
  ],
  offered: [
    { title: "Follow up with the broker on the LOI", dueInDays: 5 },
  ],
  moving_to_psa: [
    { title: "Send the PSA draft to counsel", dueInDays: 3 },
    { title: "Order title commitment", dueInDays: 3 },
    { title: "Engage environmental (Phase I)", dueInDays: 3 },
    { title: "Send the seller the DD request list (Exhibit A)", dueInDays: 3 },
    { title: "Set up the acquisition entity", dueInDays: 10 },
  ],
  due_diligence: [
    { title: "Order survey", dueInDays: 2 },
    { title: "Order zoning report / verification letter", dueInDays: 3 },
    { title: "Schedule site inspection / property condition", dueInDays: 7 },
    { title: "Get insurance quote", dueInDays: 14 },
    { title: "Review title and survey; draft objections", dueInDays: 21 },
  ],
  closed: [
    { title: "Upload closing documents to the vault", dueInDays: 3 },
    { title: "Send the property-management handoff package", dueInDays: 5 },
    { title: "Send tenant / utility notices", dueInDays: 5 },
  ],
};

export function tasksForStage(stage: string, today: string, openTitles: Iterable<string>) {
  const open = new Set([...openTitles].map((t) => t.trim().toLowerCase()));
  return (STAGE_TASKS[stage] ?? [])
    .filter((t) => !open.has(t.title.toLowerCase()))
    .map((t) => {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + t.dueInDays);
      return { title: t.title, due_date: d.toISOString().slice(0, 10) };
    });
}
