// Financials tab: price, basis, yield and returns as KPI cards first, then the
// working panels -- offers, LOI, in-place rent, the underwriting model and its
// versions, MLA, and the comps that justify the assumptions.

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
import { KpiCard } from "@/components/ui";
import type { CompRecord } from "@/lib/comps/match";

export const metadata = { title: "Financials" };

function fmtUsd(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `$${Math.round(v).toLocaleString()}`;
}
function fmtX(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `${v.toFixed(2)}x`;
}

export default async function FinancialsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const [deal, site, evidence, dealContacts] = await Promise.all([getDeal(id), getSiteView(id), getEvidence(), getDealContacts(id)]);
  const k = dealKpis(deal, site.snapshot);
  const returns = latestReturns(deal);
  const basisFlag = site.flags.find((f) => f.key === "basis");
  const rentFlag = site.flags.find((f) => f.key === "rent");
  const versionsDesc = [...(deal.uw_versions ?? [])].sort((a: any, b: any) => b.version_number - a.version_number);
  const latestVersion = versionsDesc[0];

  return (
    <div className="ws-body">
      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <KpiCard label="Price" value={k.priceLabel} sub={k.priceBasis} />
        <KpiCard label="Basis" value={k.basisLabel} unit={k.basis != null ? k.basisUnit : undefined} sub={basisFlag?.note} subTone={basisFlag?.state} />
        <KpiCard label="Yr-1 yield" value={k.yieldLabel} sub="In-place cap on price" />
        <KpiCard label="Stabilized RoC" value={fmtPct(returns?.stabilizedReturnOnCostPct)} />
        <KpiCard label="IRR" value={fmtPct(returns?.irrPct)} sub={returns?.holdPeriodYears ? `${returns.holdPeriodYears}-yr hold` : undefined} />
        <KpiCard label="Equity multiple" value={k.emLabel} />
      </div>

      <OffersPanel dealId={deal.id} offers={deal.offers ?? []} lotSf={deal.properties?.lot_sf ?? null} />

      {["uw", "offered", "moving_to_psa", "due_diligence"].includes(deal.stage) && (
        <LoiPanel dealId={deal.id} defaults={loiDefaults(deal, dealContacts as any[])} />
      )}

      <section className="panel">
        <h2>In-place rent</h2>
        <p className="hint">
          Drives the Rent Upside flag: {rentFlag?.note ?? "not assessed yet"}.
        </p>
        <InPlaceRentForm
          dealId={deal.id}
          rent={deal.in_place_rent ?? null}
          basis={deal.in_place_rent_basis ?? null}
          ios={deal.asset_class !== "industrial"}
        />
      </section>

      <section className="panel">
        <h2>Returns summary</h2>
        {!returns ? (
          <p className="muted">No underwriting uploaded yet.</p>
        ) : (
          <div className="metrics-grid">
            <Metric label="Purchase price" value={fmtUsd(returns.purchasePrice)} />
            <Metric label="All-in cost" value={fmtUsd(returns.allInCost)} />
            <Metric label="Going-in yield" value={fmtPct(returns.goingInYieldPct)} />
            <Metric label="Stabilized return on cost" value={fmtPct(returns.stabilizedReturnOnCostPct)} />
            <Metric label="Exit cap" value={fmtPct(returns.exitCapPct)} />
            <Metric label="Hold period" value={`${returns.holdPeriodYears ?? "—"} yrs`} />
            <Metric label="IRR" value={fmtPct(returns.irrPct)} />
            <Metric label="Equity multiple" value={fmtX(returns.equityMultiple)} />
            <Metric label="Stabilized cash-on-cash" value={fmtPct(returns.stabilizedCashOnCashPct)} />
          </div>
        )}
        {latestVersion?.returns_summary?.warnings?.length > 0 && (
          <div className="warning">
            <p>Parser flagged on this version:</p>
            <ul>
              {latestVersion.returns_summary.warnings.map((w: string, i: number) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        <ExcelUploadForm dealId={deal.id} />
      </section>

      <section className="panel">
        <h2>Version history</h2>
        {versionsDesc.length === 0 ? (
          <p className="muted">No versions yet.</p>
        ) : (
          <ul className="version-list">
            {versionsDesc.map((v: any) => (
              <li key={v.id}>
                <strong>v{v.version_number}</strong> — IRR {fmtPct(v.returns_summary?.irrPct)}, {fmtX(v.returns_summary?.equityMultiple)}
                <span className="muted">
                  {" "}
                  · {v.created_by} · {new Date(v.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>MLA</h2>
        <p className="muted">Status: {deal.mla_status}</p>
        {deal.mla_status === "requested" && <MlaProvideForm dealId={deal.id} />}
        {deal.mla_data?.length > 0 && (
          <div className="metrics-grid">
            {deal.mla_data.map((m: any) => (
              <Metric key={m.id} label="Market base rent" value={String(m.market_base_rent ?? m.asking_rent ?? "—")} />
            ))}
          </div>
        )}
      </section>

      {/* Market evidence the MLA assumptions are meant to follow from. */}
      <DealCompsPanel
        dealId={deal.id}
        comps={evidence.comps as CompRecord[]}
        subject={subjectOf(deal)}
        subjectAddress={deal.properties?.address ?? "This deal"}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}
