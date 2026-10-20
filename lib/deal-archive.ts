// lib/deal-archive.ts
//
// Archiving, restoring and deleting one deal -- the rules behind the deal
// page's Archive / Delete buttons, shared with the portfolio page, which
// applies them to every site at once. Each returns an outcome rather than an
// HTTP response so a portfolio can report per site.

import { getServiceClient } from "./supabase";
import { logDealEvent } from "./deals";
import { fireStageChangeWebhook } from "./webhooks";
import { canConfirmPsa } from "./auth";

// Restoring into one of these is the same as confirming the PSA, so it needs
// the same sign-off.
const PSA_OR_LATER = new Set(["moving_to_psa", "due_diligence", "closed"]);

export type Outcome = { ok: true } | { ok: false; status: number; error: string };

export interface ArchiveInput {
  reason: string;
  disposition?: string | null;
  pursuitScore?: number | string | null;
  followUpOn?: string | null;
}

export async function archiveDeal(dealId: string, input: ArchiveInput, actor: string): Promise<Outcome> {
  const supabase = getServiceClient();
  const { data: deal, error: readError } = await supabase.from("deals").select("stage").eq("id", dealId).maybeSingle();
  if (readError) return { ok: false, status: 500, error: readError.message };
  if (!deal) return { ok: false, status: 404, error: "Deal not found" };
  if (deal.stage === "archived") return { ok: false, status: 409, error: "Deal is already archived" };
  // A closed deal is an owned asset; archiving it would un-own the asset.
  if (deal.stage === "closed") return { ok: false, status: 400, error: "Closed deals can't be archived. Record a sale on the asset instead." };
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) return { ok: false, status: 400, error: "Give a reason for archiving" };

  // Targeting is captured AT archive time (score 0 = never a target), so
  // deals don't have to be hunted down later to classify them.
  const update: Record<string, unknown> = { stage: "archived", death_stage: deal.stage, death_reason: reason };
  if (input.disposition) update.disposition = input.disposition;
  if (input.pursuitScore !== undefined && input.pursuitScore !== null && input.pursuitScore !== "") {
    const score = Number(input.pursuitScore);
    if (!Number.isFinite(score)) return { ok: false, status: 400, error: "Pursuit score must be a number" };
    update.pursuit_score = score;
  }
  if (input.followUpOn) update.follow_up_on = input.followUpOn;

  // Conditional on the stage just read, so a concurrent stage move isn't overwritten.
  const { data: moved, error } = await supabase.from("deals").update(update).eq("id", dealId).eq("stage", deal.stage).select("id");
  if (error) return { ok: false, status: 500, error: error.message };
  if (!moved?.length) return { ok: false, status: 409, error: "The deal changed. Refresh and try again." };
  await logDealEvent(dealId, "archived", { stage: deal.stage, reason, score: update.pursuit_score ?? null, follow_up: input.followUpOn ?? null }, actor);
  await fireStageChangeWebhook(dealId, { from: deal.stage, to: "archived", actor, via: "archive" });
  return { ok: true };
}

export async function restoreDeal(dealId: string, actor: string): Promise<Outcome> {
  const supabase = getServiceClient();
  const { data: deal, error: readError } = await supabase.from("deals").select("stage, death_stage, death_reason").eq("id", dealId).maybeSingle();
  if (readError) return { ok: false, status: 500, error: readError.message };
  if (!deal) return { ok: false, status: 404, error: "Deal not found" };
  if (deal.stage !== "archived") return { ok: false, status: 409, error: "Only archived deals can be restored" };
  // Back to the stage it died at. uw_v1 was retired into UW (0007); a deal
  // with no recorded stage goes to UW.
  const toStage = !deal.death_stage || deal.death_stage === "uw_v1" ? "uw" : deal.death_stage;
  if (PSA_OR_LATER.has(toStage) && !canConfirmPsa(actor)) {
    return { ok: false, status: 403, error: "Only Rhett/John can restore a deal into PSA or later" };
  }
  const { data: moved, error } = await supabase
    .from("deals")
    .update({ stage: toStage, death_stage: null, death_reason: null })
    .eq("id", dealId)
    .eq("stage", "archived")
    .select("id");
  if (error) return { ok: false, status: 500, error: error.message };
  if (!moved?.length) return { ok: false, status: 409, error: "The deal changed. Refresh and try again." };
  // The death fields are cleared on the deal; keep them on the event so the
  // loss history survives the restore.
  await logDealEvent(dealId, "restored", { to: toStage, died_at: deal.death_stage, reason: deal.death_reason }, actor);
  await fireStageChangeWebhook(dealId, { from: "archived", to: toStage, actor, via: "restore" });
  return { ok: true };
}

/** Why this deal can't be deleted by this person, or null when it can. */
export function deleteBlocker(deal: { stage: string; portfolio_asset_id?: string | null }, actor: string): string | null {
  // A closed deal (or one tied to an owned asset) is the asset's purchase
  // record; deleting it would leave the asset marked owned with no deal behind
  // it. In-contract deals carry money and dates -- only the PSA signers delete
  // those, and archiving is usually what's wanted.
  if (deal.stage === "closed" || deal.portfolio_asset_id) return "Closed deals can't be deleted. Record a sale on the asset instead.";
  if (["moving_to_psa", "due_diligence"].includes(deal.stage) && !canConfirmPsa(actor)) {
    return "Only Rhett/John can delete a deal that's under contract. Archive it instead.";
  }
  return null;
}

/**
 * Permanent removal. Child rows cascade via FK; the property row goes too
 * when no other deal references it. Returns a warning when the property row
 * couldn't be removed.
 */
export async function deleteDeal(deal: { id: string; property_id: string | null }): Promise<Outcome & { warning?: string }> {
  const supabase = getServiceClient();
  const { error: delError } = await supabase.from("deals").delete().eq("id", deal.id);
  if (delError) return { ok: false, status: 500, error: delError.message };
  if (deal.property_id) {
    const { data: siblings } = await supabase.from("deals").select("id").eq("property_id", deal.property_id).limit(1);
    if (!siblings || siblings.length === 0) {
      const { error: propError } = await supabase.from("properties").delete().eq("id", deal.property_id);
      if (propError) return { ok: true, warning: `Deal deleted, but its property row remains: ${propError.message}` };
    }
  }
  return { ok: true };
}
