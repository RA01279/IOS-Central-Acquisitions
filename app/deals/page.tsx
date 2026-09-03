import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import {
  ACQUISITION_STAGES,
  ASSET_CLASSES,
  ASSET_CLASS_LABELS,
  STAGE_COLORS,
  STAGE_LABELS,
} from "@/lib/deals";
import { ctToday, addDays } from "@/lib/summary";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import CardDeleteButton from "@/components/CardDeleteButton";
import PipelineMap, { type PipelineMapDeal } from "@/components/PipelineMap";

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
  "marked_closed",
  "stage_corrected",
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

function Card({ deal, showClass, soonCutoff }: { deal: any; showClass: boolean; soonCutoff: string }) {
  const days = daysInStage(deal);
  // A DD expiry or closing inside the next 7 days is the single most
  // time-critical fact about a deal, so it rides on the card itself.
  const dd = deal.dd_end_on as string | null;
  const closing = deal.closing_on as string | null;
  const ddSoon = !!dd && dd <= soonCutoff;
  const closingSoon = !!closing && closing <= soonCutoff;

  return (
    <div className="pipeline-card-wrap">
      <Link href={`/deals/${deal.id}`} className="pipeline-card">
        <span className="address">{deal.properties?.address ?? "Untitled deal"}</span>
        <span className="market muted">
          {showClass ? `${ASSET_CLASS_LABELS[deal.asset_class] ?? ""} · ` : ""}
          {deal.properties?.market ?? ""}
        </span>
        {deal.stage === "closed" ? (
          <span className="stage-age">{deal.closed_on ? `closed ${deal.closed_on}` : "closed"}</span>
        ) : (
          <span className={days >= 14 ? "stage-age stage-age-old" : "stage-age"}>
            {days === 0 ? "today" : `${days}d in stage`}
          </span>
        )}
        {dd && deal.stage !== "closed" && (
          <span className={ddSoon ? "stage-age stage-age-old" : "stage-age"}>DD to {dd}</span>
        )}
        {closing && deal.stage !== "closed" && (
          <span className={closingSoon ? "stage-age stage-age-old" : "stage-age"}>
            closes {closing}
          </span>
        )}
        {deal.mla_status === "requested" && <span className="badge">awaiting MLA</span>}
      </Link>
      <CardDeleteButton dealId={deal.id} />
    </div>
  );
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: { asset?: string };
}) {
  // Two pipelines, toggled -- IOS is the default because it's the bulk of the
  // book. "all" is available for anyone who wants the whole thing at once.
  const assetParam = searchParams.asset;
  const asset =
    assetParam === "all" || (ASSET_CLASSES as readonly string[]).includes(assetParam ?? "")
      ? (assetParam as string)
      : "ios";

  const supabase = getServiceClient();
  let query = supabase
    .from("deals")
    .select(
      "id, stage, asset_class, mla_status, created_at, dd_end_on, closing_on, closed_on, properties(address, city, market, latitude, longitude, lot_sf, building_sf), offers(price, offered_at), deal_events(event_type, created_at)"
    )
    .eq("deal_type", "acquisition")
    .neq("stage", "archived")
    .order("created_at", { ascending: false });
  if (asset !== "all") query = query.eq("asset_class", asset);
  const { data: deals } = await query;

  // Flattened for the map: coordinates live on the property, and the popup
  // wants the latest offer rather than the whole offer history. The map shows
  // every stage EXCEPT archived, which the query above already excludes.
  const mapDeals: PipelineMapDeal[] = (deals ?? []).map((d: any) => {
    const latest = [...(d.offers ?? [])].sort((a: any, b: any) =>
      (b.offered_at ?? "").localeCompare(a.offered_at ?? "")
    )[0];
    return {
      id: d.id,
      stage: d.stage,
      asset_class: d.asset_class ?? null,
      address: d.properties?.address ?? null,
      city: d.properties?.city ?? null,
      market: d.properties?.market ?? null,
      latitude: d.properties?.latitude ?? null,
      longitude: d.properties?.longitude ?? null,
      lot_sf: d.properties?.lot_sf ?? null,
      building_sf: d.properties?.building_sf ?? null,
      dd_end_on: d.dd_end_on ?? null,
      closing_on: d.closing_on ?? null,
      closed_on: d.closed_on ?? null,
      last_offer_price: latest?.price ?? null,
    };
  });

  const soonCutoff = addDays(ctToday(), 7);

  const byStage = STAGES.reduce<Record<string, any[]>>((acc, s) => {
    acc[s] = (deals ?? []).filter((d: any) => d.stage === s);
    return acc;
  }, {});

  return (
    <>
      <Nav active="pipeline" />
      <AutoRefresh />
      <main className="wide">
        <div className="page-header">
          <div>
            <h1>Pipeline</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {asset === "all"
                ? `All acquisitions · ${deals?.length ?? 0} active`
                : `${ASSET_CLASS_LABELS[asset]} acquisitions · ${deals?.length ?? 0} active`}
            </p>
          </div>
          <div className="header-actions">
            <Link href="/deals/new" className="button-link">
              + New deal
            </Link>
          </div>
        </div>

        <div className="filter-chips">
          {ASSET_CLASSES.map((c) => (
            <Link
              key={c}
              href={c === "ios" ? "/deals" : `/deals?asset=${c}`}
              className={asset === c ? "chip chip-active" : "chip"}
            >
              {ASSET_CLASS_LABELS[c]}
            </Link>
          ))}
          <Link href="/deals?asset=all" className={asset === "all" ? "chip chip-active" : "chip"}>
            All
          </Link>
        </div>

        <PipelineMap
          deals={mapDeals}
          stages={[...STAGES]}
          stageLabels={STAGE_LABELS}
          stageColors={STAGE_COLORS}
          assetClassLabels={ASSET_CLASS_LABELS}
        />

        <div className="pipeline-board pipeline-board-6">
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
                    <Card
                      key={deal.id}
                      deal={deal}
                      showClass={asset === "all"}
                      soonCutoff={soonCutoff}
                    />
                  ))}
                  {hidden.length > 0 && (
                    <details className="pipeline-more">
                      <summary>Show {hidden.length} more</summary>
                      <div className="pipeline-cards">
                        {hidden.map((deal: any) => (
                          <Card
                            key={deal.id}
                            deal={deal}
                            showClass={asset === "all"}
                            soonCutoff={soonCutoff}
                          />
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
