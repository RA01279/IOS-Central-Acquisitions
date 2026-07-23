import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser, canConfirmPsa } from "@/lib/auth";
import { getDealContacts, listContacts, ROLE_LABELS, ROLES_BY_DEAL_TYPE } from "@/lib/crm";
import { notFound } from "next/navigation";
import Link from "next/link";
import StageActions from "@/components/StageActions";
import MlaProvideForm from "@/components/MlaProvideForm";
import ExcelUploadForm from "@/components/ExcelUploadForm";
import DealContactsPanel from "@/components/DealContactsPanel";
import DealCrmPanels from "@/components/DealCrmPanels";
import OffersPanel from "@/components/OffersPanel";
import TargetingPanel from "@/components/TargetingPanel";
import RestoreDealButton from "@/components/RestoreDealButton";
import TruncatedList from "@/components/TruncatedList";
import { ACQUISITION_STAGES } from "@/lib/deals";
import Nav from "@/components/Nav";
import BackButton from "@/components/BackButton";
import DeleteDealButton from "@/components/DeleteDealButton";

const STAGE_LABELS: Record<string, string> = {
  prospect: "Prospect",
  uw: "UW",
  uw_v1: "UW v1", // legacy -- display only
  offered: "Offered",
  moving_to_psa: "Moving to PSA",
  due_diligence: "Due Diligence",
  archived: "Archived",
};

function fmtPct(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`;
}
function fmtUsd(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `$${Math.round(v).toLocaleString()}`;
}
function fmtX(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `${v.toFixed(2)}x`;
}

export default async function DealDetailPage({ params }: { params: { id: string } }) {
  const supabase = getServiceClient();
  const user = await getCurrentUser();

  const { data: deal } = await supabase
    .from("deals")
    .select(
      "*, properties(*), mla_data(*), uw_versions(*), documents(*), deal_events(*), offers(*)"
    )
    .eq("id", params.id)
    .single();

  if (!deal) return notFound();

  const [dealContacts, allContacts] = await Promise.all([
    getDealContacts(deal.id),
    listContacts(),
  ]);

  const latestVersion = [...(deal.uw_versions ?? [])].sort(
    (a: any, b: any) => b.version_number - a.version_number
  )[0];
  const returns = latestVersion?.returns_summary ?? null;

  const versionsDesc = [...(deal.uw_versions ?? [])].sort(
    (a: any, b: any) => b.version_number - a.version_number
  );
  const eventsDesc = [...(deal.deal_events ?? [])].sort(
    (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const userCanConfirmPsa = user ? canConfirmPsa(user.email) : false;

  const stageIdx = (ACQUISITION_STAGES as readonly string[]).indexOf(deal.stage);
  const prevStage = stageIdx > 0 ? ACQUISITION_STAGES[stageIdx - 1] : null;

  return (
    <>
    <Nav active="acquisitions" />
    <main className="deal-detail">
      <BackButton />

      <div className="deal-header">
        <div>
          <h1>{deal.properties?.address}</h1>
          <p className="muted">
            {deal.properties?.market ?? "—"} · {deal.properties?.asset_type?.toUpperCase()}
          </p>
        </div>
        <span className={`stage-badge stage-${deal.stage}`}>{STAGE_LABELS[deal.stage] ?? deal.stage}</span>
      </div>

      {deal.stage === "archived" && (
        <div className="archived-banner">
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
      />

      {deal.stage === "archived" && (
        <TargetingPanel
          dealId={deal.id}
          disposition={deal.disposition ?? null}
          pursuitScore={deal.pursuit_score ?? null}
          followUpOn={deal.follow_up_on ?? null}
        />
      )}

      <section className="panel">
        <h2>Property</h2>
        <div className="metrics-grid">
          <div>
            <span className="label">City / Submarket</span>
            <span className="value">
              {[deal.properties?.city, deal.properties?.submarket].filter(Boolean).join(" / ") || "—"}
            </span>
          </div>
          <div>
            <span className="label">Acres</span>
            <span className="value">
              {deal.properties?.lot_sf ? (deal.properties.lot_sf / 43560).toFixed(2) : "—"}
            </span>
          </div>
          <div>
            <span className="label">Lot SF</span>
            <span className="value">
              {deal.properties?.lot_sf ? Math.round(deal.properties.lot_sf).toLocaleString() : "—"}
            </span>
          </div>
          <div>
            <span className="label">Building SF</span>
            <span className="value">
              {deal.properties?.building_sf ? Math.round(deal.properties.building_sf).toLocaleString() : "—"}
            </span>
          </div>
          <div>
            <span className="label">Occupancy</span>
            <span className="value">
              {deal.properties?.occupancy_status === "occupied"
                ? `Occupied${deal.properties?.walt_years ? ` · ${deal.properties.walt_years} yr WALT` : ""}`
                : deal.properties?.occupancy_status === "vacant"
                  ? "Vacant"
                  : "—"}
            </span>
          </div>
          <div>
            <span className="label">Tenancy</span>
            <span className="value">
              {deal.properties?.tenancy === "single_tenant"
                ? "Single-tenant"
                : deal.properties?.tenancy === "multi_tenant"
                  ? "Multi-tenant"
                  : "—"}
            </span>
          </div>
          <div>
            <span className="label">Source</span>
            <span className="value">
              {deal.marketing_status === "marketed"
                ? "Marketed"
                : deal.marketing_status === "off_market"
                  ? "Off-Market"
                  : "—"}
            </span>
          </div>
          <div>
            <span className="label">Type</span>
            <span className="value">
              {deal.acquisition_type === "slb"
                ? "Sale-leaseback"
                : deal.acquisition_type === "unsolicited"
                  ? "Unsolicited"
                  : deal.acquisition_type === "standard"
                    ? "Standard"
                    : "—"}
            </span>
          </div>
        </div>
      </section>

      <OffersPanel
        dealId={deal.id}
        offers={deal.offers ?? []}
        lotSf={deal.properties?.lot_sf ?? null}
      />

      <section className="panel">
        <h2>Returns summary</h2>
        {!returns ? (
          <p className="muted">No underwriting uploaded yet.</p>
        ) : (
          <div className="metrics-grid">
            <div>
              <span className="label">Purchase price</span>
              <span className="value">{fmtUsd(returns.purchasePrice)}</span>
            </div>
            <div>
              <span className="label">All-in cost</span>
              <span className="value">{fmtUsd(returns.allInCost)}</span>
            </div>
            <div>
              <span className="label">Going-in yield</span>
              <span className="value">{fmtPct(returns.goingInYieldPct)}</span>
            </div>
            <div>
              <span className="label">Stabilized return on cost</span>
              <span className="value">{fmtPct(returns.stabilizedReturnOnCostPct)}</span>
            </div>
            <div>
              <span className="label">Exit cap</span>
              <span className="value">{fmtPct(returns.exitCapPct)}</span>
            </div>
            <div>
              <span className="label">Hold period</span>
              <span className="value">{returns.holdPeriodYears ?? "—"} yrs</span>
            </div>
            <div>
              <span className="label">IRR</span>
              <span className="value highlight">{fmtPct(returns.irrPct)}</span>
            </div>
            <div>
              <span className="label">Equity multiple</span>
              <span className="value highlight">{fmtX(returns.equityMultiple)}</span>
            </div>
            <div>
              <span className="label">Stabilized cash-on-cash</span>
              <span className="value">{fmtPct(returns.stabilizedCashOnCashPct)}</span>
            </div>
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
        <h2>MLA</h2>
        <p className="muted">Status: {deal.mla_status}</p>
        {deal.mla_status === "requested" && <MlaProvideForm dealId={deal.id} />}
        {deal.mla_data?.length > 0 && (
          <div className="metrics-grid">
            {deal.mla_data.map((m: any) => (
              <div key={m.id}>
                <span className="label">Market base rent</span>
                <span className="value">{m.market_base_rent ?? m.asking_rent ?? "—"}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <DealContactsPanel
        dealId={deal.id}
        links={dealContacts as any}
        contacts={allContacts.map((c: any) => ({ id: c.id, name: c.name }))}
        roleOptions={ROLES_BY_DEAL_TYPE.acquisition}
        roleLabels={ROLE_LABELS}
      />

      <section className="panel">
        <h2>Version history</h2>
        {versionsDesc.length === 0 ? (
          <p className="muted">No versions yet.</p>
        ) : (
          <ul className="version-list">
            {versionsDesc.map((v: any) => (
              <li key={v.id}>
                <strong>v{v.version_number}</strong> — IRR {fmtPct(v.returns_summary?.irrPct)}, {fmtX(v.returns_summary?.equityMultiple)}
                <span className="muted"> · {v.created_by} · {new Date(v.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Documents</h2>
        {deal.documents?.length ? (
          <ul className="doc-list">
            {deal.documents.map((d: any) => (
              <li key={d.id}>
                <span className="doc-type">{d.doc_type.toUpperCase()}</span> {d.storage_path.split("/").pop()}
                <span className="muted"> · {d.uploaded_by}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No documents yet.</p>
        )}
      </section>

      <DealCrmPanels dealId={deal.id} />

      <section className="panel">
        <h2>Activity</h2>
        <TruncatedList
          className="event-list"
          items={eventsDesc.map((e: any) => (
            <li key={e.id}>
              <span className="muted">{new Date(e.created_at).toLocaleString()}</span> — {e.event_type} ({e.actor})
            </li>
          ))}
        />
      </section>

      <DeleteDealButton dealId={deal.id} redirectTo="/deals" />
    </main>
    </>
  );
}
