import { transitionError } from "./stage-rules";

export const PORTFOLIO_STAGES = [
  { value: "prospect", label: "Prospect" },
  { value: "uw", label: "Underwriting" },
  { value: "offered", label: "Offered" },
  { value: "moving_to_psa", label: "Moving to PSA" },
  { value: "due_diligence", label: "Due Diligence" },
  { value: "closed", label: "Closed" },
];
const ACTIONS: Record<string, string> = {
  uw: "start_underwriting", offered: "mark_offered", moving_to_psa: "confirm_psa",
  due_diligence: "move_to_due_diligence", closed: "mark_closed",
};

export function portfolioStageAction(from: string, to: string) {
  if (!PORTFOLIO_STAGES.some((s) => s.value === to)) return { error: "Choose a valid acquisition stage" };
  if (from === to) return { skip: true };
  const correction = PORTFOLIO_STAGES.findIndex((s) => s.value === to) < PORTFOLIO_STAGES.findIndex((s) => s.value === from);
  const error = transitionError(from, to, correction);
  if (error) return { error };
  return { action: correction ? "set_acq_stage" : ACTIONS[to], correction };
}

export function pricedPortfolioAssets<T extends { stage: string; allocatedPrice: number | null }>(assets: T[], to: string): T[] {
  return assets.filter((asset) => {
    if (!(Number(asset.allocatedPrice) > 0) || asset.stage === to || ["closed", "archived"].includes(asset.stage)) return false;
    const plan = portfolioStageAction(asset.stage, to);
    return !!plan.action && !plan.correction;
  });
}

export function groupPortfolioStageAssets<T extends { portfolioId: string | null; stage: string }>(assets: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const asset of assets) {
    if (!asset.portfolioId) continue;
    const key = `${asset.portfolioId}:${asset.stage}`;
    groups.set(key, [...(groups.get(key) ?? []), asset]);
  }
  return groups;
}
