import { modelIdentity } from "./investment-review";

export class BriefError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}
export const briefMoney = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "Not available";
export const briefPct = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : "Not available";
const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;

/** Only the selected deal's persisted model version is used. No uploads or writes. */
export function acquisitionBrief(deal: any, versionId?: string) {
  const versions = [...(deal.uw_versions ?? [])].filter((v: any) => !v.deal_id || v.deal_id === deal.id)
    .sort((a: any, b: any) => b.version_number - a.version_number);
  const version = versionId ? versions.find((v: any) => v.id === versionId) : versions[0];
  if (!version) throw new BriefError(versionId ? "That model version does not belong to this deal." : "Upload an underwriting model on Financials first.", versionId ? 404 : 409);
  const identity = modelIdentity(deal, version);
  if (!identity.usable) throw new BriefError("This version was marked as a wrong upload. Choose another version or resolve the model identity on Financials.");
  const s = version.returns_summary ?? {}, detail = version.model_detail ?? {}, uw = detail.uw ?? {};
  const source = (deal.documents ?? []).find((d: any) => d.id === version.excel_document_id && (!d.deal_id || d.deal_id === deal.id));
  const fileName = uw.fileName ?? source?.file_name ?? source?.storage_path?.split("/").pop() ?? "Saved underwriting workbook";
  const p = deal.properties ?? {};
  const warnings = [...new Set<string>([
    ...(!identity.authoritative ? identity.issues : []),
    ...(Array.isArray(s.warnings) ? s.warnings : []), ...(Array.isArray(detail.warnings) ? detail.warnings : []),
    ...(!detail.uw ? ["Detailed model data was not saved for this version. Re-upload to populate lease, capex and recoveries."] : []),
  ])];
  const rows = (uw.rentRoll ?? []).map((r: any) => ({
    tenant: String(r.tenant ?? "Tenant not recorded"), start: r.start ?? "Not available", expiration: r.expiration ?? "Not available",
    rent: briefMoney(number(r.rentAnnual)), marketRent: briefMoney(number(r.marketAnnual)),
  }));
  const capex = Array.isArray(uw.capexByYear) && uw.capexByYear.length ? uw.capexByYear.map((amount: any, year: number) => ({ year, amount: number(amount) })) : [];
  const review = deal.investment_review ?? {};
  const facts = [
    { label: "Contract price (deal record)", value: briefMoney(number(deal.contract_price)) },
    { label: "Income evidence status", value: review.incomeStatus ?? "unknown" },
    { label: "Income source (recorded)", value: review.incomeSource ?? "Not recorded; lease terms below are model assumptions" },
    { label: "Lease page / section", value: "Not verified; no page citation supplied" },
  ];
  return {
    dealId: deal.id, address: String(p.address ?? "Property not recorded"), location: [p.city, p.market].filter(Boolean).join(" / "),
    assetClass: deal.asset_class === "industrial" ? "Industrial" : "IOS", stage: String(deal.stage ?? "Not recorded"),
    property: `${p.lot_sf == null ? "Land not recorded" : `${(Number(p.lot_sf) / 43560).toFixed(2)} acres`} | ${p.building_sf == null ? "Building SF not recorded" : `${Number(p.building_sf).toLocaleString("en-US")} building SF`}`,
    versionId: version.id, versionNumber: version.version_number, uploadedAt: version.created_at, fileName: String(fileName),
    historical: version.id !== versions[0]?.id, identityConfirmed: identity.authoritative, warnings,
    metrics: [
      { label: "Purchase price", value: briefMoney(number(s.purchasePrice)) },
      { label: "All-in basis", value: briefMoney(number(s.allInCost)) },
      { label: "Levered IRR", value: briefPct(number(s.irrPct)) },
      { label: "Equity multiple", value: number(s.equityMultiple) == null ? "Not available" : `${s.equityMultiple.toFixed(2)}x` },
    ],
    returns: [
      { label: "Levered IRR", value: number(s.irrPct) },
      { label: "Going-in yield", value: number(s.goingInYieldPct) },
      { label: "Return on cost", value: number(s.stabilizedReturnOnCostPct) },
      { label: s.cashOnCashBasis === "average" ? "Average cash-on-cash" : "Stabilized cash-on-cash", value: number(s.stabilizedCashOnCashPct) },
    ],
    assumptions: [
      { label: "Exit cap / hold", value: `${briefPct(number(s.exitCapPct))} / ${number(s.holdPeriodYears) == null ? "Not available" : `${s.holdPeriodYears} years`}` },
      { label: "Year 1 NOI", value: briefMoney(number(uw.year1Noi)) },
      { label: "Expense reimbursements", value: briefMoney(number(uw.recoveriesYear1)) + " (separate from NOI)" },
      { label: "Recovery assumption (MLA)", value: deal.mla_data?.[0]?.recovery_type ?? "Not available" },
      { label: "Capex by model year", value: capex.length ? capex.map((c: any) => `Y${c.year}: ${briefMoney(c.amount)}`).join("; ") : "Not available" },
    ], facts, tenants: rows,
  };
}
export type AcquisitionBrief = ReturnType<typeof acquisitionBrief>;
