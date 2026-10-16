// lib/ic-decisions.ts
//
// Investment Committee outcomes on a deal (table ic_decisions). The newest
// decision stands; "approved" and "conditional" count as approval for PSA.

import { getServiceClient } from "./supabase";

export const IC_OUTCOMES = ["approved", "conditional", "declined", "deferred"] as const;
export const IC_OUTCOME_LABELS: Record<string, string> = {
  approved: "Approved",
  conditional: "Approved with conditions",
  declined: "Declined",
  deferred: "Deferred",
};
export const IC_DECISION_COLUMNS = "id, deal_id, decided_on, outcome, approved_price, conditions, notes, created_by, created_at";

export type IcDecision = {
  id: string;
  deal_id: string;
  decided_on: string;
  outcome: string;
  approved_price: number | null;
  conditions: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
};

export const isApproval = (d: { outcome: string } | null | undefined) => d?.outcome === "approved" || d?.outcome === "conditional";

/** Whether Moving to PSA needs an IC approval on record first. */
export const icRequiredForPsa = () => process.env.REQUIRE_IC_APPROVAL_FOR_PSA === "1";

export async function listIcDecisions(dealId: string): Promise<IcDecision[]> {
  const { data, error } = await getServiceClient()
    .from("ic_decisions")
    .select(IC_DECISION_COLUMNS)
    .eq("deal_id", dealId)
    .order("decided_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Loading IC decisions: ${error.message}`);
  return (data ?? []) as IcDecision[];
}
