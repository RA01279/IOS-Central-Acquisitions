import { getServiceClient } from "@/lib/supabase";
import { ACQUISITION_STAGES, ASSET_CLASSES, ASSET_CLASS_LABELS, STAGE_LABELS } from "@/lib/deals";
import { ctToday, addDays } from "@/lib/summary";
import { DEAL_CARD_SELECT, toDealCard, type DealCardData } from "@/lib/deal-view";
import { loadSignals } from "@/lib/site-signals";
import { fmtMoney } from "@/lib/format";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import CardDeleteButton from "@/components/CardDeleteButton";
import DealGrid from "@/components/DealGrid";
import AutoSubmit from "@/components/AutoSubmit";
import { DarkKpi } from "@/components/ui";
import { Search } from "lucide-react";

// Live, per-request, auth-gated data -- never statically prerender this at
// build time (doing so also fails the build when Supabase env isn't present).
export const dynamic = "force-dynamic";
export const metadata = { title: "Deals" };

const SORTS: Record<string, string> = {
  score: "Site score",
  newest: "Newest",
  price: "Price",
  stale: "Days in stage",
};

type Params = { asset?: string; market?: string; stage?: string; sort?: string; view?: string; q?: string };

// Every filter lives in the URL, so a link reproduces the exact view.
function href(base: Params, patch: Partial<Params>): string {
  const merged: Record<string, string | undefined> = { ...base, ...patch };
  const qs = Object.entries(merged)
    .filter(([k, v]) => v && !(k === "asset" && v === "ios") && !(k === "view" && v === "cards") && !(k === "sort" && v === "score"))
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join("&");
  return `/deals${qs ? `?${qs}` : ""}`;
}

export default async function DealsPage(props: { searchParams: Promise<Params> }) {
  const sp = await props.searchParams;
  // Two pipelines, toggled -- IOS is the default because it's the bulk of the
  // book. "all" is available for anyone who wants the whole thing at once.
  const asset =
    sp.asset === "all" || (ASSET_CLASSES as readonly string[]).includes(sp.asset ?? "") ? (sp.asset as string) : "ios";
  const view = sp.view === "board" ? "board" : "cards";
  const sort = SORTS[sp.sort ?? ""] ? sp.sort! : "score";
  const stage = (ACQUISITION_STAGES as readonly string[]).includes(sp.stage ?? "") ? sp.stage! : "";
  const q = (sp.q ?? "").trim();
  const base: Params = { asset, market: sp.market, stage: stage || undefined, sort, view, q: q || undefined };

  const supabase = getServiceClient();
  let query = supabase
    .from("deals")
    .select(DEAL_CARD_SELECT)
    .eq("deal_type", "acquisition")
    .neq("stage", "archived")
    .order("created_at", { ascending: false });
  if (asset !== "all") query = query.eq("asset_class", asset);
  const { data: rows } = await query;
  const deals = rows ?? [];
  const signals = await loadSignals(deals.map((d: any) => d.id));
  const cards: DealCardData[] = deals.map((d: any) => toDealCard(d, signals.get(d.id)));

  // ---- header KPIs (whole pipeline for this asset class, ignoring filters)
  const active = cards.filter((c) => c.stage !== "closed");
  const value = active.reduce((a, c) => a + (c.price ?? 0), 0);
  const priced = active.filter((c) => c.price).length;
  const scored = active.filter((c) => c.score != null);
  const avgScore = scored.length ? Math.round(scored.reduce((a, c) => a + c.score!, 0) / scored.length) : null;
  const today = ctToday();
  const weekOut = addDays(today, 7);
  const toIc = active.filter((c) => c.icOn && c.icOn >= today && c.icOn <= weekOut).length;

  // Market chips: the busiest markets first.
  const marketCounts = new Map<string, number>();
  for (const c of active) if (c.market) marketCounts.set(c.market, (marketCounts.get(c.market) ?? 0) + 1);
  const markets = [...marketCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([m]) => m);

  // ---- filters
  const needle = q.toLowerCase();
  let shown = cards.filter(
    (c) =>
      (!sp.market || c.market === sp.market) &&
      (!stage || c.stage === stage) &&
      (!needle || [c.name, c.city, c.market, c.ref].some((v) => v?.toLowerCase().includes(needle)))
  );
  const by: Record<string, (a: DealCardData, b: DealCardData) => number> = {
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
    newest: () => 0, // query order
    price: (a, b) => (b.price ?? 0) - (a.price ?? 0),
    stale: (a, b) => b.days - a.days,
  };
  shown = [...shown].sort(by[sort]);

  const soonCutoff = addDays(today, 7);

  return (
    <>
      <Nav active="deals" />
      <AutoRefresh />
      <main className="bleed">
        <div className="ph">
          <div className="ph-row">
            <div className="ph-title">
              <span className="eyebrow">{asset === "all" ? "All" : ASSET_CLASS_LABELS[asset]} Acquisitions Pipeline</span>
              <h1>Deals</h1>
            </div>
            <div className="ph-actions">
              {ASSET_CLASSES.map((c) => (
                <a key={c} href={href(base, { asset: c, market: undefined })} className={asset === c ? "tchip on" : "tchip"} style={asset === c ? { background: "#fff", color: "#0A2540", borderColor: "#fff" } : { background: "transparent", color: "#A9D0EC", borderColor: "rgba(255,255,255,.2)" }}>
                  {ASSET_CLASS_LABELS[c]}
                </a>
              ))}
              <a href={href(base, { asset: "all", market: undefined })} className="tchip" style={asset === "all" ? { background: "#fff", color: "#0A2540", borderColor: "#fff" } : { background: "transparent", color: "#A9D0EC", borderColor: "rgba(255,255,255,.2)" }}>
                All
              </a>
              <a href="/deals/new" className="btn-inverse">New Deal</a>
            </div>
          </div>
          <div className="ph-kpis">
            <DarkKpi label="Active deals" value={active.length} />
            <DarkKpi
              label="Pipeline value"
              value={fmtMoney(value)}
              sub={priced < active.length ? `${active.length - priced} unpriced` : undefined}
            />
            <DarkKpi label="Avg site score" value={avgScore ?? "—"} sub={`${scored.length} of ${active.length} scored`} />
            <DarkKpi label="To IC this week" value={toIc} />
          </div>
        </div>

        <form className="toolbar" action="/deals" method="get">
          {asset !== "ios" && <input type="hidden" name="asset" value={asset} />}
          {view !== "cards" && <input type="hidden" name="view" value={view} />}
          {sp.market && <input type="hidden" name="market" value={sp.market} />}
          <a href={href(base, { market: undefined })} className={!sp.market ? "tchip on" : "tchip"}>
            All markets
          </a>
          {markets.map((m) => (
            <a key={m} href={href(base, { market: m })} className={sp.market === m ? "tchip on" : "tchip"}>
              {m}
            </a>
          ))}
          <span className="tdiv" />
          <AutoSubmit name="stage" value={stage} aria-label="Stage">
            <option value="">Stage: Any</option>
            {ACQUISITION_STAGES.map((s) => (
              <option key={s} value={s}>
                Stage: {STAGE_LABELS[s]}
              </option>
            ))}
          </AutoSubmit>
          <AutoSubmit name="sort" value={sort} aria-label="Sort">
            {Object.entries(SORTS).map(([k, l]) => (
              <option key={k} value={k}>
                Sort: {l}
              </option>
            ))}
          </AutoSubmit>
          <a href={href(base, { view: view === "cards" ? "board" : "cards" })} className="tchip">
            {view === "cards" ? "Board view" : "Card view"}
          </a>
          <span style={{ flex: 1 }} />
          <label className="tsearch">
            <Search size={15} color="#9AA8B5" />
            <input name="q" defaultValue={q} placeholder="Search address, city, D-#" />
          </label>
        </form>

        {view === "cards" ? (
          shown.length ? (
            <DealGrid cards={shown} />
          ) : (
            <p className="empty-state">No deals match these filters.</p>
          )
        ) : (
          <div style={{ padding: "18px 28px 40px" }}>
            <div className="pipeline-board pipeline-board-6">
              {ACQUISITION_STAGES.map((s) => {
                const col = shown.filter((c) => c.stage === s);
                return (
                  <section key={s} className="pipeline-column">
                    <h2>
                      {STAGE_LABELS[s]}
                      <span className="count">{col.length}</span>
                    </h2>
                    <div className="pipeline-cards">
                      {col.map((c) => {
                        const deal = deals.find((d: any) => d.id === c.id) as any;
                        const dd = deal?.dd_end_on as string | null;
                        return (
                          <div key={c.id} className="pipeline-card-wrap">
                            <a href={`/deals/${c.id}`} className="pipeline-card">
                              <span className="address">{c.name}</span>
                              <span className="market muted">{c.market ?? ""}</span>
                              <span className={c.days >= 14 ? "stage-age stage-age-old" : "stage-age"}>
                                {s === "closed" ? `closed ${deal?.closed_on ?? ""}` : c.days === 0 ? "today" : `${c.days}d in stage`}
                              </span>
                              {dd && s !== "closed" && (
                                <span className={dd <= soonCutoff ? "stage-age stage-age-old" : "stage-age"}>DD to {dd}</span>
                              )}
                            </a>
                            <CardDeleteButton dealId={c.id} />
                          </div>
                        );
                      })}
                      {col.length === 0 && <p className="empty">Nothing here</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
