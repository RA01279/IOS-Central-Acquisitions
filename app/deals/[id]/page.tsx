// app/deals/[id]/page.tsx -- Summary tab: the verdict first, readable in five
// seconds (score, price, basis, yield, demand), then the six viability flags,
// tenant demand and next dates. Stage moves sit up top because they're the
// most common action; property details, contacts and delete come last.

import { getCurrentUser, canConfirmPsa } from "@/lib/auth";
import { ACQUISITION_ROLES, getDealContacts, listContacts, listOpenTasksForDeal, ROLE_LABELS } from "@/lib/crm";
import { ACQUISITION_STAGES, STAGE_LABELS } from "@/lib/deals";
import { ctToday } from "@/lib/summary";
import { dealKpis, getDeal, getSiteView } from "@/lib/deal-workspace";
import { scoreSummary } from "@/lib/site-score";
import { hex, scoreState, signal } from "@/lib/hopper-tokens";
import StageActions from "@/components/StageActions";
import DealEditForm from "@/components/DealEditForm";
import DealContactsPanel from "@/components/DealContactsPanel";
import TargetingPanel from "@/components/TargetingPanel";
import RestoreDealButton from "@/components/RestoreDealButton";
import DeleteDealButton from "@/components/DeleteDealButton";
import SignalsPanel from "@/components/SignalsPanel";
import NextDates, { type DateRow } from "@/components/NextDates";
import { DemandBars, KpiCard } from "@/components/ui";

function fmtUsd(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `$${Math.round(v).toLocaleString()}`;
}

export default async function DealSummaryPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const [deal, site, user] = await Promise.all([getDeal(id), getSiteView(id), getCurrentUser()]);
  const [dealContacts, allContacts, tasks] = await Promise.all([
    getDealContacts(deal.id),
    listContacts(),
    listOpenTasksForDeal(deal.id),
  ]);

  const k = dealKpis(deal, site.snapshot, 3);
  const st = signal[site.score.state];
  const basisFlag = site.flags.find((f) => f.key === "basis");
  const basisSub = basisFlag && basisFlag.state !== "unknown" ? /\(([^)]+)\)/.exec(basisFlag.note)?.[1] : null;
  const refreshedAt = site.flags.map((f) => f.at).filter(Boolean).sort().pop() ?? null;

  const stageIdx = (ACQUISITION_STAGES as readonly string[]).indexOf(deal.stage);
  const prevStage = stageIdx > 0 ? ACQUISITION_STAGES[stageIdx - 1] : null;
  const userCanConfirmPsa = user ? canConfirmPsa(user.email) : false;
  const p = deal.properties ?? {};

  const today = ctToday();
  const dateRows: DateRow[] = [
    { label: "LOI response due", date: deal.loi_response_due_on ?? null },
    { label: "IC presentation", date: deal.ic_on ?? null },
    { label: "Phase I ordered", date: deal.phase1_ordered_on ?? null, empty: "Pending", event: true },
    ...(deal.dd_end_on && deal.stage !== "closed" ? [{ label: "DD expires", date: deal.dd_end_on }] : []),
    ...(deal.closing_on && deal.stage !== "closed" ? [{ label: "Target closing", date: deal.closing_on }] : []),
    ...(tasks as any[])
      .filter((t) => t.due_date)
      .slice(0, 3)
      .map((t) => ({ label: t.title, date: t.due_date as string })),
  ];

  return (
    <div className="ws-body">
      {deal.stage === "archived" && (
        <div className="archived-banner" style={{ marginBottom: 0 }}>
          Archived at <strong>{STAGE_LABELS[deal.death_stage] ?? deal.death_stage}</strong>
          {deal.death_reason ? ` — ${deal.death_reason}` : ""}
          <RestoreDealButton dealId={deal.id} />
        </div>
      )}

      <StageActions
        dealId={deal.id}
        stage={deal.stage}
        canConfirmPsa={userCanConfirmPsa}
        prevStage={prevStage}
        prevStageLabel={prevStage ? STAGE_LABELS[prevStage] : null}
        ddEndOn={deal.dd_end_on ?? null}
        closingOn={deal.closing_on ?? null}
        contractPrice={deal.contract_price ?? null}
      />

      {deal.stage === "archived" && (
        <TargetingPanel
          dealId={deal.id}
          disposition={deal.disposition ?? null}
          pursuitScore={deal.pursuit_score ?? null}
          followUpOn={deal.follow_up_on ?? null}
        />
      )}

      <div className="kpi-row">
        <div className="kpi kpi-hero" style={{ background: hex(st.bg), borderColor: hex(st.fg) }}>
          <span className="k-big" style={{ color: hex(st.fg) }}>
            {site.score.score ?? "—"}
          </span>
          <span style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span className="k-label" style={{ color: hex(st.fg) }}>
              Site score · {site.score.score == null ? "Incomplete" : st.label}
            </span>
            <span style={{ font: "400 12px/1.4 var(--font-body)", color: "#232B33" }}>{scoreSummary(site.score)}</span>
          </span>
        </div>
        <KpiCard label="Price" value={k.priceLabel} sub={k.priceBasis} />
        <KpiCard
          label="Basis"
          value={k.basisLabel}
          unit={k.basis != null ? k.basisUnit : undefined}
          sub={basisSub ?? (basisFlag?.state === "unknown" ? "No comp read yet" : undefined)}
          subTone={basisFlag?.state}
        />
        <KpiCard label="Yr-1 yield" value={k.yieldLabel} sub={k.stabilizedLabel} />
        <KpiCard
          label="Demand index"
          value={k.demand.index ?? "—"}
          sub={k.demand.index == null ? "Not searched yet" : "3 mi radius"}
          subTone={k.demand.index == null ? undefined : scoreState(k.demand.index)}
        />
      </div>

      <div className="sum-split">
        <SignalsPanel dealId={deal.id} flags={site.flags} refreshedAt={refreshedAt} />
        <div className="stack">
          <div className="card" style={{ gap: 10 }}>
            <div className="card-head">
              <span className="overline">Tenant demand</span>
              <a href={`/deals/${deal.id}/demand-map`} className="link-caps">
                Open map
              </a>
            </div>
            {site.snapshot ? (
              <DemandBars rows={k.demand.rows} limit={6} />
            ) : (
              <p className="hint" style={{ margin: 0 }}>
                No demand search yet. Score this site, or run one from the map.
              </p>
            )}
          </div>
          <NextDates
            dealId={deal.id}
            today={today}
            rows={dateRows}
            editable={{
              icOn: deal.ic_on ?? null,
              loiResponseDueOn: deal.loi_response_due_on ?? null,
              phase1OrderedOn: deal.phase1_ordered_on ?? null,
            }}
          />
          <a href={`/deals/${deal.id}/notes?new=site_visit`} className="btn btn-primary btn-block mobile-only">
            Add Site-Visit Note
          </a>
        </div>
      </div>

      <section className="panel">
        <h2>Property</h2>
        {deal.classification_basis && <p className="hint">Classification: {deal.classification_basis}</p>}
        <div className="metrics-grid">
          <Metric label="City / Submarket" value={[p.city, p.submarket].filter(Boolean).join(" / ") || "—"} />
          <Metric label="Acres" value={p.lot_sf ? (p.lot_sf / 43560).toFixed(2) : "—"} />
          <Metric label="Building SF" value={p.building_sf ? Math.round(p.building_sf).toLocaleString() : "—"} />
          <Metric
            label="Occupancy"
            value={
              p.occupancy_status === "occupied"
                ? `Occupied${p.walt_years ? ` · ${p.walt_years} yr WALT` : ""}`
                : p.occupancy_status === "vacant"
                  ? "Vacant"
                  : "—"
            }
          />
          <Metric
            label="Tenancy"
            value={p.tenancy === "single_tenant" ? "Single-tenant" : p.tenancy === "multi_tenant" ? "Multi-tenant" : "—"}
          />
          <Metric
            label="Source"
            value={deal.marketing_status === "marketed" ? "Marketed" : deal.marketing_status === "off_market" ? "Off-Market" : "—"}
          />
          <Metric
            label="Type"
            value={
              deal.acquisition_type === "slb"
                ? "Sale-leaseback"
                : deal.acquisition_type === "unsolicited"
                  ? "Unsolicited"
                  : deal.acquisition_type === "standard"
                    ? "Standard"
                    : "—"
            }
          />
          <Metric label="Contract price" value={fmtUsd(deal.contract_price)} />
          <Metric label="Final closing price" value={fmtUsd(deal.closed_price)} />
        </div>
        <DealEditForm
          dealId={deal.id}
          property={deal.properties}
          assetClass={deal.asset_class}
          marketingStatus={deal.marketing_status ?? null}
          acquisitionType={deal.acquisition_type ?? null}
          ddEndOn={deal.dd_end_on ?? null}
          closingOn={deal.closing_on ?? null}
          contractPrice={deal.contract_price ?? null}
          closedPrice={deal.closed_price ?? null}
        />
      </section>

      <DealContactsPanel
        dealId={deal.id}
        links={dealContacts as any}
        contacts={allContacts.map((c: any) => ({ id: c.id, name: c.name, company: c.companies?.name ?? null }))}
        roleOptions={ACQUISITION_ROLES}
        roleLabels={ROLE_LABELS}
      />

      <DeleteDealButton dealId={deal.id} redirectTo="/deals" />
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
