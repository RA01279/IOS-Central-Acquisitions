import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import { ACQUISITION_STAGES, STAGE_LABELS } from "@/lib/deals";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import CardDeleteButton from "@/components/CardDeleteButton";

// Live, per-request, auth-gated data -- never statically prerender this at
// build time (doing so also fails the build when Supabase env isn't present).
export const dynamic = "force-dynamic";

const STAGES = ACQUISITION_STAGES;
const CARDS_SHOWN = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

// Event types that mark a stage transition -- the newest one tells us when
// the deal entered its current stage.
const STAGE_EVENTS = new Set([
  "deal_created",
  "advanced_to_uw",
  "marked_offered",
  "confirmed_psa",
  "entered_due_diligence",
  "stage_corrected",
  "lease_stage_changed",
  "restored",
]);

function daysInStage(deal: any): number {
  const stamps = (deal.deal_events ?? [])
    .filter((e: any) => STAGE_EVENTS.has(e.event_type))
    .map((e: any) => e.created_at)
    .sort();
  const entered = stamps.pop() ?? deal.created_at;
  return Math.max(0, Math.floor((Date.now() - new Date(entered).getTime()) / DAY_MS));
}

function Card({ deal }: { deal: any }) {
  const days = daysInStage(deal);
  return (
    <div className="pipeline-card-wrap">
      <Link href={`/deals/${deal.id}`} className="pipeline-card">
        <span className="address">{deal.properties?.address ?? "Untitled deal"}</span>
        <span className="market muted">{deal.properties?.market ?? ""}</span>
        <span className={days >= 14 ? "stage-age stage-age-old" : "stage-age"}>
          {days === 0 ? "today" : `${days}d in stage`}
        </span>
        {deal.mla_status === "requested" && <span className="badge">awaiting MLA</span>}
      </Link>
      <CardDeleteButton dealId={deal.id} />
    </div>
  );
}

export default async function DealsPage() {
  const supabase = getServiceClient();
  const { data: deals } = await supabase
    .from("deals")
    .select(
      "id, stage, mla_status, created_at, properties(address, market), deal_events(event_type, created_at)"
    )
    .eq("deal_type", "acquisition")
    .neq("stage", "archived")
    .order("created_at", { ascending: false });

  const byStage = STAGES.reduce<Record<string, any[]>>((acc, s) => {
    acc[s] = (deals ?? []).filter((d: any) => d.stage === s);
    return acc;
  }, {});

  return (
    <>
      <Nav active="acquisitions" />
      <AutoRefresh />
      <main>
        <div className="page-header">
          <h1>Acquisitions</h1>
          <div className="header-actions">
            <Link href="/deals/new" className="button-link">
              + New deal
            </Link>
          </div>
        </div>

        <div className="pipeline-board pipeline-board-5">
          {STAGES.map((stage) => {
            const cards = byStage[stage];
            const visible = cards.slice(0, CARDS_SHOWN);
            const hidden = cards.slice(CARDS_SHOWN);
            return (
              <section key={stage} className="pipeline-column">
                <h2>
                  {STAGE_LABELS[stage]}
                  <span className="count">{cards.length}</span>
                </h2>
                <div className="pipeline-cards">
                  {visible.map((deal: any) => (
                    <Card key={deal.id} deal={deal} />
                  ))}
                  {hidden.length > 0 && (
                    <details className="pipeline-more">
                      <summary>Show {hidden.length} more</summary>
                      <div className="pipeline-cards">
                        {hidden.map((deal: any) => (
                          <Card key={deal.id} deal={deal} />
                        ))}
                      </div>
                    </details>
                  )}
                  {cards.length === 0 && <p className="empty">Nothing here</p>}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </>
  );
}
