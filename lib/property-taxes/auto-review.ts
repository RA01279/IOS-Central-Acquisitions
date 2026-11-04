// lib/property-taxes/auto-review.ts
//
// Hopper's automatic review of clear-cut tax research, so people only see the
// doubtful cases. It never overrides a person: it only acts on parcels still
// "pending", records without an annual review, and a missing or stale parcel-set
// review that Hopper itself wrote. Everything it does is labeled "Auto-reviewed
// by Hopper" and can be reopened in the Property Taxes workspace.
//
// Rules (agreed with acquisitions, 2026-11-04):
//  1. Parcel: include when the county parcel polygon contains the pin AND the
//     situs address matches -- or the address differs but the parcel is part of
//     the site Hopper outlines (same-owner touching parcels) and that site's
//     recorded acreage is within 5% of the deal's. Texas/Georgia real-property
//     accounts cover land and improvements, so the component is "combined".
//  2. Parcel set: verified when every remaining parcel is included and the
//     parcels equal Hopper's outlined site (by appraisal account) with
//     matching acreage.
//  3. Amounts: an official, retained bill for the right account and tax year is
//     marked reviewed (the same test the coverage check already applies).
//  4. Year reconciled: the statement's taxing authorities add up to the bill
//     to the cent AND include a school district. Collector subtotals that leave
//     the school district out (e.g. Harris County's tax office history) are not.

import type { TaxState, TaxParcel, TaxRecord } from "./types";
import { sourcedBill } from "./coverage";
import { parcelScopeBasis, parcelScopeVerified } from "./parcel-scope";
import { recordObligationReview, obligationReviewProblem } from "./obligation-review";
import { normalizedAccount } from "./accounts";

export const AUTO_NOTE = "Auto-reviewed by Hopper";
const SCHOOL = /\b(ISD|CISD|school|schools)\b/i;

export interface SiteFootprint {
  /** Appraisal account IDs of Hopper's outlined site (empty = unknown). */
  accountIds: string[];
  /** Outlined acreage within 5% of the deal's (null = deal acreage unknown). */
  matchesDeal: boolean | null;
}

export interface AutoReviewResult {
  state: TaxState;
  /** What Hopper approved, one line each. */
  actions: string[];
  /** Why the rest still needs a person, one line each. */
  blockers: string[];
}

const pinMatch = (p: TaxParcel) => p.matchEvidence.some((e) => /polygon intersects the subject pin/i.test(e));
const addressMatch = (p: TaxParcel) => p.matchEvidence.some((e) => /situs address matches/i.test(e));
const addressDiffers = (p: TaxParcel) => p.matchEvidence.some((e) => /address differs|cannot override a conflicting situs/i.test(e));
const inSite = (p: TaxParcel, site?: SiteFootprint | null) =>
  !!site?.accountIds.length && site.accountIds.some((a) => normalizedAccount(a) === normalizedAccount(p.accountId));

export function autoReview(input: TaxState, site?: SiteFootprint | null, now = new Date()): AutoReviewResult {
  const state = structuredClone(input);
  const actions: string[] = [], blockers: string[] = [];
  const day = now.toISOString().slice(0, 10);

  // 1. Parcels.
  for (const p of state.parcels) {
    if (p.review !== "pending" || p.identityOverride) continue;
    const reasons: string[] = [];
    if (pinMatch(p) && addressMatch(p) && !addressDiffers(p)) reasons.push("the county parcel contains the map pin and its situs address matches");
    else if (pinMatch(p) && inSite(p, site) && site!.matchesDeal === true) reasons.push("the county parcel contains the map pin and is part of the outlined site, whose recorded acreage matches the deal within 5%");
    if (!reasons.length) {
      blockers.push(`${p.accountId}: ${!pinMatch(p) ? "the parcel does not contain the map pin" : site?.matchesDeal === false ? "the situs address differs and the outlined site's acreage does not match the deal" : "the situs address differs from the deal's"} — confirm it belongs to the acquisition.`);
      continue;
    }
    p.review = "included";
    if (p.component === "unknown" && /^(TX|GA)$/.test(p.state)) p.component = "combined";
    p.reviewNote = `${AUTO_NOTE} ${day}: ${reasons.join("; ")}.${p.component === "combined" ? " Real-property account covering land and improvements." : ""} Reopen to change.`;
    actions.push(`Included parcel ${p.accountId} (${p.county}).`);
  }
  for (const p of state.parcels) if (p.review === "included" && p.component === "unknown") blockers.push(`${p.accountId}: set whether the account is land, building or both.`);

  // 2. Parcel set.
  const live = state.parcels.filter((p) => p.review !== "excluded");
  const autoScope = !state.scopeReview || state.scopeReview.note.startsWith(AUTO_NOTE);
  if (!parcelScopeVerified(state) && autoScope && live.length) {
    const evidence = [...new Set(live.flatMap((p) => p.sourceIds))].filter((id) => state.sources.some((s) => s.id === id && s.storagePath && s.evidence.trim()));
    const accounts = new Set(live.map((p) => normalizedAccount(p.accountId)));
    const sameSet = !!site?.accountIds.length && site.accountIds.length === accounts.size && site.accountIds.every((a) => accounts.has(normalizedAccount(a)));
    if (live.some((p) => p.review !== "included" || p.component === "unknown")) blockers.push("Parcel set: approve every parcel first.");
    else if (!site?.accountIds.length) blockers.push("Parcel set: Hopper could not outline the site from county parcels here; confirm the acquisition boundary.");
    else if (!sameSet) blockers.push(`Parcel set: the outlined site has ${site.accountIds.length} account${site.accountIds.length === 1 ? "" : "s"} (${site.accountIds.join(", ")}) but tax research has ${accounts.size}; add or exclude accounts so they agree.`);
    else if (site.matchesDeal === false) blockers.push("Parcel set: the outlined site's recorded acreage differs from the deal's by more than 5%.");
    else if (!evidence.length) blockers.push("Parcel set: no retained county record to cite; rerun research.");
    else {
      state.scopeReview = {
        at: now.toISOString(),
        note: `${AUTO_NOTE} ${day}: the included accounts are exactly the parcels in Hopper's outlined site (same owner, touching)${site.matchesDeal ? ", whose recorded acreage matches the deal within 5%" : "; the deal has no acreage to compare"}.`,
        sourceIds: evidence,
        parcelKeys: live.map((p) => p.key),
        basis: parcelScopeBasis(state),
      } as TaxState["scopeReview"];
      actions.push(`Verified the parcel set (${live.length} account${live.length === 1 ? "" : "s"}).`);
    }
  }

  // 3. Amounts, then 4. annual reconciliation.
  for (const row of state.records) {
    const parcel = state.parcels.find((p) => p.key === row.parcelKey);
    if (!parcel || parcel.review !== "included") continue;
    const levied = row.facts.levied;
    if (levied && !levied.reviewed && sourcedBill(state, row)) {
      levied.reviewed = true;
      actions.push(`Accepted the ${row.year} bill for ${parcel.accountId} from the official record.`);
    }
    if (!levied?.reviewed || !obligationReviewProblem(state, row)) continue;
    if (row.obligationReview && !row.obligationReview.note.startsWith(AUTO_NOTE)) continue; // a person's review, even if stale
    const reason = reconcileBlocker(state, row);
    if (reason) { blockers.push(`${parcel.accountId} ${row.year}: ${reason}`); continue; }
    try {
      const source = state.sources.find((s) => s.id === levied.sourceId)!;
      const reconciled = recordObligationReview(state, row, {
        asOf: source.retrievedAt,
        note: `${AUTO_NOTE} ${day}: the taxing authorities on the official ${row.billEvidence!.kind === "issued_statement" ? "statement" : "collector record"} add up to the levy to the cent and include a school district.`,
        separateCollectors: "Not checked by a person. Only authorities printed on this record are included; a district billed by another collector would not appear on it.",
        revisions: `Not checked by a person; uses the record retrieved ${source.retrievedAt.slice(0, 10)}.`,
        sourceIds: [...new Set([source.id, ...row.jurisdictions.map((j) => j.sourceId)])],
        authorities: row.jurisdictions.map((j) => ({ name: j.name, levied: j.levied as number, sourceId: j.sourceId })),
      });
      state.records = reconciled.records;
      actions.push(`Reconciled ${parcel.accountId} ${row.year} (${row.jurisdictions.length} authorities).`);
    } catch (e) {
      blockers.push(`${parcel.accountId} ${row.year}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { state, actions, blockers: [...new Set(blockers)] };
}

/** Why a year can't be reconciled automatically, or null when it can. */
function reconcileBlocker(state: TaxState, row: TaxRecord): string | null {
  const levied = row.facts.levied!;
  if (!row.billEvidence) return "no structured bill record to reconcile.";
  if (row.billEvidence.obligationStatus === "temporary" || /temporary bill|under appeal/i.test(String(row.facts.appeal?.value ?? ""))) return "temporary or appealed bill; needs the final bill.";
  const source = state.sources.find((s) => s.id === levied.sourceId);
  if (!source?.storagePath) return "the bill's original record was not retained.";
  const auth = row.jurisdictions;
  if (!auth.length || auth.some((j) => typeof j.levied !== "number" || !Number.isFinite(j.levied))) return "the record doesn't break the bill down by taxing authority.";
  if (auth.some((j) => !state.sources.some((s) => s.id === j.sourceId && s.storagePath))) return "an authority's amount lacks a retained source.";
  const cents = auth.reduce((t, j) => t + Math.round((j.levied as number) * 100), 0);
  if (cents !== Math.round((levied.value as number) * 100)) return "the authorities don't add up to the bill.";
  if (!auth.some((j) => SCHOOL.test(j.name))) return "no school district on this record; it is likely billed separately.";
  return null;
}
