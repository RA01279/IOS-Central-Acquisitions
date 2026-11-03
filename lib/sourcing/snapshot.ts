import type { Site } from "./sweep";
import type { BuyBox } from "./markets";
import { blocksSourcing } from "./identity";

export const SNAPSHOT_LABEL = "Reviewed sourcing sites v2";
export interface ReviewedSourcing { version: 2; sweepId: string; market: string; searchLabel: string; buyBox: BuyBox; sites: Site[] }
export function validBuyBox(v: any): v is BuyBox {
  return !!v && [v.minAcres, v.maxAcres, v.maxCoveragePct].every(n => typeof n === "number" && Number.isFinite(n)) &&
    v.minAcres > 0 && v.maxAcres >= v.minAcres && v.maxAcres <= 1000 && v.maxCoveragePct > 0 && v.maxCoveragePct <= 100;
}
export function reviewedSites(sources: unknown): ReviewedSourcing | null {
  if (!Array.isArray(sources)) return null;
  const value = sources.find(s => s?.label === SNAPSHOT_LABEL)?.data;
  return value?.version === 2 && typeof value.sweepId === "string" && Array.isArray(value.sites) && value.sites.length > 0 && value.sites.length <= 10 && validBuyBox(value.buyBox) ? value : null;
}
export function selectReviewedSites(all: Site[], refs: unknown): Site[] | null {
  if (!Array.isArray(refs) || !refs.length || refs.length > 10 || refs.some(r => typeof r !== "string") || new Set(refs).size !== refs.length) return null;
  const selected = refs.map(ref => all.find(s => s.ref === ref));
  return selected.some(s => !s || blocksSourcing(s)) ? null : selected as Site[];
}
