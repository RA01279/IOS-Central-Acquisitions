// Financials tab: price, basis, yield and returns as KPI cards first, then
// groups read top to bottom --
//   Negotiation: offers and the LOI;
//   Underwriting model: the uploaded model, its versions and sensitivities;
//   Market assumptions: the deal's own inputs (in-place rent, exit cap), what
//   the reviewed comps support, the comps themselves, and the MLA they feed;
//   Decision and evidence: the investment-review and reconciliation forms,
//   collapsed, at the bottom.

import { getDealContacts } from "@/lib/crm";
import { dealKpis, getDeal, getEvidence, getSiteView, latestReturns, subjectOf } from "@/lib/deal-workspace";
import { loiDefaults } from "@/lib/loi-defaults";
import { fmtPct } from "@/lib/format";
import OffersPanel from "@/components/OffersPanel";
import LoiPanel from "@/components/LoiPanel";
import ExcelUploadForm from "@/components/ExcelUploadForm";
import MlaProvideForm from "@/components/MlaProvideForm";
import DealCompsPanel from "@/components/DealCompsPanel";
import InPlaceRentForm from "@/components/InPlaceRentForm";
import ExitCapForm from "@/components/ExitCapForm";
import { Badge, KpiCard, type BadgeTone } from "@/components/ui";
import CompUnderwritingPanel from "@/components/CompUnderwritingPanel";
import SensitivityPanel from "@/components/SensitivityPanel";
import type { CompRecord } from "@/lib/comps/match";
import InvestmentReview from "@/components/InvestmentReview";
import DecisionContext from "@/components/DecisionContext";
import { incomePosition, latestVersion as selectedVersion, modelIdentity } from "@/lib/investment-review";
import { compReview } from "@/lib/comps/reviewed-evidence";
import { compUnderwriting, type UwComp } from "@/lib/comps/underwriting";
import { workbookWarnings } from "@/lib/workbook-messages";
import { getServiceClient } from "@/lib/supabase";
import { loadTaxWorkspace } from "@/lib/property-taxes/store";
import { taxSummary, type TaxSummary } from "@/lib/property-taxes/summary";

/** Researched property tax bills for the deal; never breaks the page. */
async function dealTaxes(dealId: string): Promise<TaxSummary | null> {
  try { return taxSummary((await loadTaxWorkspace(getServiceClient(), dealId)).state); } catch { return null; }
}

export const metadata = { title: "Financials" };

const TZ = "America/Chicago";

function fmtUsd(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `$${Math.round(v).toLocaleString("en-US")}`;
}
function fmtX(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `${v.toFixed(2)}x`;
}
// Rendered on the server (UTC on Vercel), so pin the zone the team works in
// rather than showing a time five or six hours off.
function fmtStamp(iso: string) {
  return new Date(iso).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function who(email: string | null | undefined) {
  return email ? email.split("@")[0] : "—";
}
// MLA percentages arrive both ways: 0.7 and 70, 0.0775 and 7.75.
function asPct(v: unknown, digits = 1) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return `${(n <= 1 ? n * 100 : n).toFixed(digits).replace(/\.0+$/, "")}%`;
}

const MLA_TONES: Record<string, BadgeTone> = { requested: "warning", provided: "success", assumed: "neutral" };
const MLA_LABELS: Record<string, string> = { requested: "Requested", provided: "Provided", assumed: "Assumed" };
const MLA_FIELDS = ["market_base_rent", "term_years", "term_months", "renewal_probability", "months_vacant", "free_rent_months", "ti_new", "ti_renew", "lc_new_pct", "lc_renew_pct", "recovery_type"];

export default async function FinancialsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const [deal, site, evidence, dealContacts, taxes] = await Promise.all([getDeal(id), getSiteView(id), getEvidence(), getDealContacts(id), dealTaxes(id)]);
  const k = dealKpis(deal, site.snapshot);
  const returns = latestReturns(deal);
  const ios = deal.asset_class !== "industrial";
  const basisFlag = site.flags.find((f) => f.key === "basis");
  const rentFlag = site.flags.find((f) => f.key === "rent");
  const versionsDesc = [...(deal.uw_versions ?? [])].sort((a: any, b: any) => b.version_number - a.version_number);
  // The selected workbook, and the same version unless someone has marked it a
  // wrong upload -- returns and the model's own tables come from the latter. An
  // unconfirmed identity (often stale template data) is a warning, not a block.
  const sourceVersion = selectedVersion(deal);
  const identity = sourceVersion ? modelIdentity(deal, sourceVersion) : null;
  const latestVersion = identity?.usable ? sourceVersion : null;
  const sourceWarnings = workbookWarnings(returns?.warnings ?? sourceVersion?.returns_summary?.warnings);
  const dealExitCap = deal.exit_cap_rate != null ? Number(deal.exit_cap_rate) : null;
  const reviewed = compReview(deal, evidence.comps, subjectOf(deal));
  const uw = compUnderwriting(reviewed.comps as UwComp[], reviewed.subject, { exitCap: dealExitCap ?? returns?.exitCapPct ?? null });
  // Latest MLA reply that actually carries numbers (a status flip can leave an empty row).
  const mla: any = [...(deal.mla_data ?? [])]
    .filter((m: any) => MLA_FIELDS.some((f) => m[f] != null && m[f] !== ""))
    .sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];
  // The basis flag note leads with the basis itself, which the card already shows.
  const basisSub = basisFlag?.note?.replace(/^.*?\svs\s/, "vs ");

  return (
    <div className="ws-body fin">
      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <KpiCard label="Price" value={k.priceLabel} sub={k.priceBasis} />
        <KpiCard label="Basis" value={k.basisLabel} unit={k.basis != null ? k.basisUnit : undefined} sub={basisSub} subTone={basisFlag?.state} title={basisFlag?.note} />
        <KpiCard label="Workbook Yr-1 yield" value={k.yieldLabel} sub={incomePosition(deal).current ? "In-place status; workbook assumptions" : "Modeled income; current in-place yield unverified"} />
        <KpiCard label="Stabilized RoC" value={fmtPct(returns?.stabilizedReturnOnCostPct)} />
        <KpiCard label="IRR" value={fmtPct(returns?.irrPct)} sub={returns?.holdPeriodYears ? `${returns.holdPeriodYears}-yr hold` : undefined} />
        <KpiCard label="Equity multiple" value={k.emLabel} />
      </div>

      <h2 className="fin-group">Negotiation</h2>
      <OffersPanel dealId={deal.id} offers={deal.offers ?? []} lotSf={deal.properties?.lot_sf ?? null} round={Number(deal.offer_round) || 1} dueOn={deal.call_for_offers_on ?? null} />
      {["uw", "offered", "moving_to_psa", "due_diligence"].includes(deal.stage) && (
        <LoiPanel dealId={deal.id} defaults={loiDefaults(deal, dealContacts as any[])} />
      )}

      <h2 className="fin-group">Underwriting model</h2>
      <section className="panel">
        <div className="fin-head">
          <h2>Model</h2>
          {sourceVersion && (
            <>
              {!latestVersion ? <Badge tone="danger">Marked wrong upload</Badge> : !identity?.authoritative && <Badge tone="warning">Identity unconfirmed</Badge>}
              <span className="fin-head-meta">
                v{sourceVersion.version_number} · {who(sourceVersion.created_by)} · {fmtStamp(sourceVersion.created_at)}
              </span>
            </>
          )}
        </div>
        {returns && identity && !identity.authoritative && (
          <p className="warning">
            Check this is the right model for this property: {identity.issues.join(" ")} Accept it, or mark it a wrong upload, under{" "}
            <a href="#investment-review">Investment evidence and decision</a> at the bottom of this tab. This is often stale template data and does not block anything.
          </p>
        )}
        {returns ? (
          // IRR, multiple and return on cost are already in the cards above.
          <div className="fin-stats">
            <Stat label="Purchase price" value={fmtUsd(returns.purchasePrice)} />
            <Stat label="All-in cost" value={fmtUsd(returns.allInCost)} />
            <Stat label="Going-in yield" value={fmtPct(returns.goingInYieldPct)} />
            <Stat label="Exit cap" value={fmtPct(returns.exitCapPct)} />
            <Stat label="Hold" value={returns.holdPeriodYears != null ? `${returns.holdPeriodYears} yrs` : "—"} />
            {/* Versions saved before Nov 4 2026 (IOS) hold the stabilized year, not the average. */}
            <Stat label={returns.cashOnCashBasis === "average" ? "Avg. cash-on-cash" : "Stab. cash-on-cash"} value={fmtPct(returns.stabilizedCashOnCashPct)} />
          </div>
        ) : sourceVersion ? (
          // An upload exists but was marked a wrong upload. Never read as "nothing uploaded".
          <div className="warning">
            <p style={{ margin: 0 }}>
              <strong>v{sourceVersion.version_number} was marked a wrong upload for this property, so its returns are not shown.</strong>{" "}
              Upload the right model, or change the decision under <a href="#investment-review">Investment evidence and decision</a> at the bottom of this tab.
            </p>
          </div>
        ) : (
          <p className="muted">No underwriting uploaded yet. Upload the model workbook to fill in returns and sensitivities.</p>
        )}
        {sourceWarnings.length > 0 && (
          <div className="warning">
            <p>Workbook issues to review:</p>
            <ul>
              {sourceWarnings.map((w: string, i: number) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {latestVersion?.model_detail?.warnings?.length > 0 && (
          <div className="warning">
            <p>Source workbook discrepancies:</p>
            <ul>{latestVersion.model_detail.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
        <TaxCheck taxes={taxes} modelTax={typeof latestVersion?.model_detail?.realEstateTaxes === "number" ? latestVersion.model_detail.realEstateTaxes : null} hasModel={!!latestVersion} dealId={deal.id} />
        <ExcelUploadForm dealId={deal.id} hasModel={!!sourceVersion} />
        <p className="hint fin-note">
          Uploaded returns are the workbook&apos;s saved calculation results. Hopper does not recalculate Excel formulas. Confirm the source
          property, assumptions and calculation date before relying on them.
        </p>
        {versionsDesc.length > 0 && (
          <details className="fin-details">
            <summary>Version history ({versionsDesc.length})</summary>
            <div className="table-scroll">
              <table className="summary-table fin-table">
                <thead>
                  <tr><th>Version</th><th>Price</th><th>IRR</th><th>Multiple</th><th>Exit cap</th><th className="fin-text">Uploaded by</th><th className="fin-text">When</th></tr>
                </thead>
                <tbody>
                  {versionsDesc.map((v: any) => (
                    <tr key={v.id}>
                      <td>
                        v{v.version_number}
                        {v.id === sourceVersion?.id && <span className="fin-tag">{latestVersion ? "current" : "in review"}</span>}
                      </td>
                      <td>{fmtUsd(v.returns_summary?.purchasePrice)}</td>
                      <td>{fmtPct(v.returns_summary?.irrPct)}</td>
                      <td>{fmtX(v.returns_summary?.equityMultiple)}</td>
                      <td>{fmtPct(v.returns_summary?.exitCapPct)}</td>
                      <td className="fin-text">{who(v.created_by)}</td>
                      <td className="fin-text">{fmtStamp(v.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      <SensitivityPanel
        model={latestVersion?.model_detail ?? null}
        basePrice={returns?.purchasePrice ?? null}
        modelExitCap={latestVersion?.model_detail?.exitCap ?? returns?.exitCapPct ?? null}
        uw={uw}
        ios={ios}
        exitCap={dealExitCap ?? returns?.exitCapPct ?? null}
        holdYears={returns?.holdPeriodYears ?? null}
        cost={returns?.allInCost ?? returns?.purchasePrice ?? k.price ?? null}
        baseIrr={returns?.irrPct ?? null}
        baseMultiple={returns?.equityMultiple ?? null}
      />

      <h2 className="fin-group">Market assumptions</h2>
      <section className="panel">
        <h2>Deal inputs</h2>
        <div className="fin-inputs">
          <div>
            <InPlaceRentForm dealId={deal.id} rent={deal.in_place_rent ?? null} basis={deal.in_place_rent_basis ?? null} ios={ios} />
            <p className="hint fin-note">Drives the Rent Upside flag: {rentFlag?.note ?? "not assessed yet"}.</p>
          </div>
          <div>
            <ExitCapForm dealId={deal.id} exitCap={dealExitCap} modelExitCap={returns?.exitCapPct ?? null} />
          </div>
        </div>
      </section>

      <CompUnderwritingPanel
        uw={uw}
        ios={ios}
        modelHoldYears={returns?.holdPeriodYears ?? null}
        evidenceNote={`${reviewed.label}. Building-rent recommendations require direct building quotes; acreage conversions are diagnostic equivalents only.`}
      />

      {/* Market evidence the MLA assumptions are meant to follow from. */}
      <DealCompsPanel
        dealId={deal.id}
        comps={evidence.comps as CompRecord[]}
        subject={subjectOf(deal)}
        subjectAddress={deal.properties?.address ?? "This deal"}
      />

      <section className="panel">
        <div className="fin-head">
          <h2>MLA</h2>
          <Badge tone={MLA_TONES[deal.mla_status] ?? "neutral"}>{MLA_LABELS[deal.mla_status] ?? deal.mla_status ?? "—"}</Badge>
          {mla?.provided_by && <span className="fin-head-meta">{who(mla.provided_by)} · {fmtStamp(mla.provided_at ?? mla.created_at)}</span>}
        </div>
        {mla && (
          <div className="fin-stats">
            <Stat
              label="Market base rent"
              value={mla.market_base_rent == null ? "—" : Number(mla.market_base_rent) >= 100 ? fmtUsd(Number(mla.market_base_rent)) : `$${Number(mla.market_base_rent).toFixed(2)}/SF/mo`}
            />
            <Stat
              label="Term"
              value={
                mla.term_months >= 12
                  ? `${mla.term_months} mo`
                  : mla.term_years != null || mla.term_months != null
                    ? `${mla.term_years ?? 0} yrs${mla.term_months ? ` ${mla.term_months} mo` : ""}`
                    : "—"
              }
            />
            <Stat label="Renewal probability" value={asPct(mla.renewal_probability, 0)} />
            <Stat label="Months vacant" value={mla.months_vacant != null ? `${mla.months_vacant} mo` : "—"} />
            <Stat label="Free rent" value={mla.free_rent_months != null ? `${mla.free_rent_months} mo` : "—"} />
            <Stat label="TI new / renew" value={`${fmtUsd(mla.ti_new)} / ${fmtUsd(mla.ti_renew)}`} />
            <Stat label="LC new / renew" value={`${asPct(mla.lc_new_pct, 2)} / ${asPct(mla.lc_renew_pct, 2)}`} />
            <Stat label="Recovery" value={mla.recovery_type ?? "—"} />
          </div>
        )}
        {deal.mla_status === "requested" ? (
          <MlaProvideForm dealId={deal.id} />
        ) : !mla ? (
          <p className="muted">{deal.mla_status === "assumed" ? "No MLA requested; the model's own assumptions stand." : "No MLA figures on file."}</p>
        ) : null}
      </section>

      {/* Long review forms, collapsed and last: opened when reconciling a source, not on every visit. */}
      <h2 className="fin-group">Decision and evidence</h2>
      <DecisionContext deal={deal} />
      <InvestmentReview deal={deal} />
    </div>
  );
}

/**
 * The model's Year 1 real estate taxes against the latest researched bill. A
 * partial bill (e.g. county collector only) is a floor, so a model below it is
 * understated; against a complete bill, a gap over 10% is flagged.
 */
function TaxCheck({ taxes, modelTax, hasModel, dealId }: { taxes: TaxSummary | null; modelTax: number | null; hasModel: boolean; dealId: string }) {
  const link = <a href={`/deals/${dealId}/property-taxes`}>Property Taxes</a>;
  if (!taxes) {
    return <p className="hint fin-note">Property taxes: no researched bill yet. Run research on the {link} tab to check the model&apos;s tax line.</p>;
  }
  const gap = modelTax != null && taxes.amount > 0 ? modelTax / taxes.amount - 1 : null;
  const flag = gap == null ? null
    : taxes.status === "partial" ? (gap < 0 ? `The model's Year 1 taxes are ${Math.round(-gap * 100)}% below a partial ${taxes.year} bill, so they are understated.` : null)
    : Math.abs(gap) > 0.1 ? `The model's Year 1 taxes are ${Math.round(Math.abs(gap) * 100)}% ${gap < 0 ? "below" : "above"} the ${taxes.year} bill.` : null;
  return (
    <div className={flag ? "warning" : undefined} style={flag ? undefined : { margin: "12px 0" }}>
      <p style={{ margin: 0 }}>
        <strong>Property taxes:</strong> {taxes.year} bill {fmtUsd(taxes.amount)}{" "}
        <Badge tone={taxes.status === "complete" ? "success" : "warning"}>{taxes.status === "complete" ? "All authorities" : "Partial"}</Badge>
        {modelTax != null ? <> · model Year 1 {fmtUsd(modelTax)}</> : hasModel ? <> · model tax line not read (re-upload the model to compare)</> : null}
        {flag && <><br /><strong>{flag}</strong></>}
      </p>
      <p className="hint" style={{ margin: "4px 0 0" }}>
        {taxes.coverage}.{taxes.caveats.length > 0 && <> {taxes.caveats.join(" ")}</>} Details and sources on the {link} tab.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}
