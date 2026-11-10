// lib/stage-tasks-db.ts
//
// Creates a stage's checklist tasks (lib/stage-tasks.ts) on a deal. Never
// fatal: a stage move must not fail because a to-do didn't insert.

import { getServiceClient } from "./supabase";
import { staleChecklistTitles, tasksForStage } from "./stage-tasks";
import { ctToday } from "./summary";

export async function createStageTasks(dealId: string, stage: string, actor: string): Promise<number> {
  try {
    const db = getServiceClient();
    const [{ data: deal }, { data: open }] = await Promise.all([
      db.from("deals").select("assigned_analyst").eq("id", dealId).maybeSingle(),
      db.from("tasks").select("title").eq("deal_id", dealId).eq("status", "open"),
    ]);
    const rows = tasksForStage(stage, ctToday(), (open ?? []).map((t: any) => t.title));
    if (!rows.length) return 0;
    const assignee = deal?.assigned_analyst ?? (actor.includes("@") ? actor : null);
    const { error } = await db.from("tasks").insert(
      rows.map((r) => ({ ...r, deal_id: dealId, assigned_to: assignee, created_by: actor, notes: "Added when the deal changed stage" }))
    );
    return error ? 0 : rows.length;
  } catch {
    return 0;
  }
}

/**
 * Marks done the open checklist tasks a stage move has made moot (e.g. "Set
 * the IC date" once the deal is Offered, or everything once it's archived).
 * Only checklist titles are touched; tasks people wrote stay open. Never fatal.
 */
export async function closeStaleStageTasks(dealId: string, toStage: string): Promise<number> {
  const titles = staleChecklistTitles(toStage);
  if (!titles.length) return 0;
  try {
    const { data, error } = await getServiceClient()
      .from("tasks")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("deal_id", dealId)
      .eq("status", "open")
      .in("title", titles)
      .select("id");
    return error ? 0 : data?.length ?? 0;
  } catch {
    return 0;
  }
}
