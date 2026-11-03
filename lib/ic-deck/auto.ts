// lib/ic-deck/auto.ts
//
// Automatic executive summary: every model upload builds a draft deck from
// the saved workbook and saves it to the deal's Documents, then queues the IC
// narrative research on the uploader's Hopper helper (if it is running). When
// that research finishes, the deck is rebuilt with the drafted text. The
// helper then copies each new deck into the deal's F: drive folder (see
// /api/exec-summaries/outbox).
//
// Nothing here throws: a failure is logged on the deal and the upload or the
// agent result it follows is unaffected.

import { getServiceClient } from "../supabase";
import { logDealEvent } from "../deals";
import { buildExecSummary, saveExecSummary, BuildError } from "./build";
import { loadSavedDeckModel } from "./saved-model";
import type { ModelSummary } from "./model";
import { loadEvidence } from "../agents/context";
import { buildPrompt } from "../agents/catalog";
import { reap } from "../agents/server";

export const BUILT_EVENT = "exec_summary_built";
export const DELIVERED_EVENT = "exec_summary_delivered";
export const FAILED_EVENT = "exec_summary_failed";

type Reason = "model_upload" | "research_done";

/** Public property facts only: no price, returns or rent go to a web-searching agent. */
export function narrativeRequestText(model: ModelSummary): string {
  const p = model.property;
  return [
    `Subject: ${p.address ?? ""}, ${p.cityState ?? ""}.`,
    p.acres ? `Site: ${p.acres} acres.` : "",
    p.buildingSf ? `Building: ${Math.round(p.buildingSf).toLocaleString("en-US")} SF.` : "",
    model.rentRoll.rows.length ? `Tenant(s): ${model.rentRoll.rows.map((r) => r.tenant).join("; ")}.` : "Vacant at closing.",
  ].filter(Boolean).join(" ");
}

async function latestVersionNumber(dealId: string): Promise<number | null> {
  const { data } = await getServiceClient().from("uw_versions").select("version_number").eq("deal_id", dealId)
    .order("version_number", { ascending: false }).limit(1).maybeSingle();
  return data?.version_number ?? null;
}

/** Build the deck from the deal's latest saved workbook and file it in Documents. */
export async function autoExecSummary(dealId: string, actorEmail: string, reason: Reason, narrativeRunId?: string): Promise<string | null> {
  const db = getServiceClient();
  const email = actorEmail.toLowerCase();
  try {
    if (!narrativeRunId) {
      const { data: run } = await db.from("agent_runs").select("id").eq("deal_id", dealId).eq("owner_email", email)
        .eq("agent", "ic-narrative").eq("status", "completed").order("finished_at", { ascending: false }).limit(1).maybeSingle();
      narrativeRunId = run?.id ?? undefined;
    }
    const { data: ref } = await db.from("documents").select("id").eq("deal_id", dealId).ilike("file_name", "IC Source - %")
      .order("uploaded_at", { ascending: false }).limit(1).maybeSingle();

    let built;
    try {
      built = await buildExecSummary({ dealId, actorEmail: email, narrativeRunId, referenceId: ref?.id });
    } catch (e) {
      // A retained source deck that no longer fits (e.g. the deal was re-addressed)
      // must not stop the draft: build without it and say so.
      if (!(e instanceof BuildError) || !ref?.id) throw e;
      built = await buildExecSummary({ dealId, actorEmail: email, narrativeRunId });
      built.warnings.push(`The saved source exhibits could not be reused: ${e.message}`);
    }
    const version = await latestVersionNumber(dealId);
    const stem = built.name.replace(/ - IC Exec Summary \(draft\)\.pptx$/i, "");
    const fileName = `${stem} - Exec Summary${version != null ? ` v${version}` : ""} (${narrativeRunId ? "auto draft, researched" : "auto draft"}).pptx`;
    const { documentId } = await saveExecSummary(dealId, built.buffer, fileName, email);
    await logDealEvent(dealId, BUILT_EVENT, { documentId, fileName, version, reason, researched: !!narrativeRunId, checks: built.warnings.slice(0, 20) }, email);
    return documentId;
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    // Workbooks that aren't the IOS exec-summary template (e.g. industrial
    // models) simply have no auto deck; that isn't worth a failure entry.
    if (!/missing the ES Summary/i.test(message)) await logDealEvent(dealId, FAILED_EVENT, { reason, error: message.slice(0, 500) }, email).catch(() => {});
    return null;
  }
}

/** Queue IC narrative research on the uploader's helper. Returns why it did or didn't. */
export async function queueNarrativeResearch(dealId: string, actorEmail: string): Promise<"queued" | "helper_offline" | "already_running" | "no_model" | "failed"> {
  const db = getServiceClient();
  const email = actorEmail.toLowerCase();
  try {
    const { data: helper } = await db.from("outlook_helpers").select("id,agents_last_seen_at").eq("owner_email", email)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!helper?.agents_last_seen_at || Date.now() - Date.parse(helper.agents_last_seen_at) > 45000) return "helper_offline";
    await reap(db, email);
    const { data: running } = await db.from("agent_runs").select("id").eq("deal_id", dealId).eq("owner_email", email)
      .eq("agent", "ic-narrative").in("status", ["queued", "processing"]).limit(1).maybeSingle();
    if (running) return "already_running";
    const saved = await loadSavedDeckModel(dealId).catch(() => null);
    if (!saved) return "no_model";
    const evidence = await loadEvidence("ic-narrative", dealId);
    const prompt = buildPrompt("ic-narrative", evidence, narrativeRequestText(saved.model), new Date().toISOString());
    const { error } = await db.from("agent_runs").insert({ owner_email: email, helper_id: helper.id, agent: "ic-narrative", deal_id: dealId, prompt, sources: evidence });
    return error ? (error.code === "23505" ? "already_running" : "failed") : "queued";
  } catch { return "failed"; }
}

/** After a model upload: draft deck now, research in the background. */
export async function execSummaryAfterUpload(dealId: string, actorEmail: string) {
  await autoExecSummary(dealId, actorEmail, "model_upload");
  const research = await queueNarrativeResearch(dealId, actorEmail);
  if (research !== "queued" && research !== "already_running" && research !== "no_model")
    await logDealEvent(dealId, "exec_summary_research_skipped", { why: research }, actorEmail.toLowerCase()).catch(() => {});
}
