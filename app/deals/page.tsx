import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { listTeam } from "@/lib/team";
import { ACQUISITION_STAGES, ASSET_CLASSES, ASSET_CLASS_LABELS, STAGE_LABELS } from "@/lib/deals";
import { ctToday, addDays } from "@/lib/summary";
import { DEAL_CARD_SELECT, toDealCard, type DealCardData } from "@/lib/deal-view";
import { loadSignals } from "@/lib/site-signals";
import { fmtMoney } from "@/lib/format";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import CardDeleteButton from "@/components/CardDeleteButton";
import DealGrid from "@/components/DealGrid";
import DealFilters, { type FilterState } from "@/components/DealFilters";
import { DarkKpi } from "@/components/ui";
import { fetchAll } from "@/lib/fetch-all";

// Live, per-request, auth-gated data -- never statically prerender this at
// build time (doing so also fails the build when Supabase env isn't present).
export const dynamic = "force-dynamic";
export const metadata = { title: "Deals" };

const SORTS: Record<string, string> = {
  newest: "Newest added",
  oldest: "Oldest added",
  score: "Site score",
  price: "Price",
  stale: "Days in stage",
};

type Params = { asset?: string; market?: string; stage?: string; sort?: string; view?: string; q?: string; owner?: string };

const list = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export default async function DealsPage(props: { searchParams: Promise<Params> }) {
  const sp = await props.searchParams;
  // Two pipelines, toggled -- IOS is the default because it's the bulk of the
  // book. "all" is available for anyone who wants the whole thing at once.
  const asset =
    sp.asset === "all" || (ASSET_CLASSES as readonly string[]).includes(sp.asset ?? "") ? (sp.asset as string) : "ios";
  // Board (kanban by stage) is the default; ?view=cards shows the scored cards.
  const view = sp.view === "cards" ? "cards" : "board";
  const sort = SORTS[sp.sort ?? ""] ? sp.sort! : "newest";
  // Markets and stages are multi-select: ?market=Houston,DFW&stage=prospect,uw
  const stages = list(sp.stage).filter((x) => (ACQUISITION_STAGES as readonly string[]).includes(x));
  const marketsPicked = list(sp.market);
  const q = (sp.q ?? "").trim();
  const [user, team] = await Promise.all([getCurrentUser(), listTeam()]);
  const me = user?.email.toLowerCase() ?? "";
  const ownerPick = sp.owner === "me" || sp.owner === "none" || team.some((t) => t.email === sp.owner) ? sp.owner! : "";
  const ownerWanted = ownerPick === "me" ? me : ownerPick;
  const state: FilterState = { asset, markets: marketsPicked, stages, sort, view, q, owner: ownerPick };

  const supabase = getServiceClient();
  // Paged: one request stops at 1000 rows without saying so.
  const rows = await fetchAll((f, t) => {
    let query = supabase
      .from("deals")
      .select(DEAL_CARD_SELECT)
      .eq("deal_type", "acquisition")
      .neq("stage", "archived");
    // Portfolio sites of the other class come too: a portfolio card stands for
    // the whole package, and Project Empire's three warehouses are Industrial.
    if (asset !== "all") query = query.or(`asset_class.eq.${asset},deal_portfolio_id.not.is.null`);
    return query.order("created_at", { ascending: false }).order("id").range(f, t);
  });
  const deals = rows ?? [];
  const signals = await loadSignals(deals.map((d: any) => d.id));
  const allCards: DealCardData[] = deals.map((d: any) => toDealCard(d, signals.get(d.id)));
  const cards = asset === "all" ? allCards : allCards.filter((c) => c.assetClass === asset);

  // ---- header KPIs (whole pipeline for this asset class, ignoring filters)
  const active = cards.filter((c) => c.stage !== "closed");
  const value = active.reduce((a, c) => a + (c.price ?? 0), 0);
  const priced = active.filter((c) => c.price).length;
  const scored = active.filter((c) => c.score != null);
  const avgScore = scored.length ? Math.round(scored.reduce((a, c) => a + c.score!, 0) / scored.length) : null;
  const today = ctToday();
  const weekOut = addDays(today, 7);
  const toIc = active.filter((c) => c.icOn && c.icOn >= today && c.icOn <= weekOut).length;

  // Dropdown options with counts. Each count respects the OTHER filters, so
  // ticking Houston shows how many Houston deals sit in each stage.
  const needle = q.toLowerCase();
  const matchQ = (c: DealCardData) => !needle || [c.name, c.city, c.market, c.ref].some((v) => v?.toLowerCase().includes(needle));
  const matchM = (c: DealCardData) => !marketsPicked.length || marketsPicked.includes(c.market ?? "");
  const matchS = (c: DealCardData) => !stages.length || stages.includes(c.stage);
  const matchO = (c: DealCardData) => !ownerWanted || (ownerWanted === "none" ? !c.owner : c.owner === ownerWanted);
  const marketCounts = new Map<string, number>();
  for (const c of cards) if (c.market && matchS(c) && matchQ(c) && matchO(c)) marketCounts.set(c.market, (marketCounts.get(c.market) ?? 0) + 1);
  for (const m of marketsPicked) if (!marketCounts.has(m)) marketCounts.set(m, 0);
  const marketOptions = [...marketCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([m, n]) => ({ value: m, label: m, count: n }));
  const stageOptions = ACQUISITION_STAGES.map((st) => ({
    value: st,
    label: STAGE_LABELS[st],
    count: cards.filter((c) => c.stage === st && matchM(c) && matchQ(c) && matchO(c)).length,
  }));

  // ---- filters
  let shown = cards.filter((c) => matchM(c) && matchS(c) && matchQ(c) && matchO(c));
  const ownerCount = (o: string) => cards.filter((c) => matchM(c) && matchS(c) && matchQ(c) && (o === "none" ? !c.owner : c.owner === o)).length;
  const ownerOptions = [
    { value: "", label: "Anyone" },
    ...(me ? [{ value: "me", label: "My deals", count: ownerCount(me) }] : []),
    ...team.filter((t) => t.email !== me).map((t) => ({ value: t.email, label: t.name, count: ownerCount(t.email) })),
    { value: "none", label: "Unassigned", count: ownerCount("none") },
  ];
  const by: Record<string, (a: DealCardData, b: DealCardData) => number> = {
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
    price: (a, b) => (b.price ?? 0) - (a.price ?? 0),
    stale: (a, b) => b.days - a.days,
  };
  shown = [...shown].sort(by[sort]);

  // A portfolio's sites show as ONE card, in the stage most of its sites are
  // at (ties go to the earlier stage). Filters still apply site by site, so a
  // market filter shows the package with only its sites in that market.
  const groups = new Map<string, DealCardData[]>();
  const singles: DealCardData[] = [];
  for (const c of shown) {
    if (c.portfolioId) groups.set(c.portfolioId, [...(groups.get(c.portfolioId) ?? []), c]);
    else singles.push(c);
  }
  const packages: PortfolioCard[] = [...groups.keys()].map((id) => {
    // Filters decide whether the package shows; the card then describes all of it.
    const sites = allCards.filter((c) => c.portfolioId === id);
    const ask = (c: DealCardData) => {
      const row = deals.find((d: any) => d.id === c.id) as any;
      return c.price ?? (row?.asking_price != null ? Number(row.asking_price) : 0);
    };
    const counts = ACQUISITION_STAGES.map((st) => [st, sites.filter((c) => c.stage === st).length] as const).filter(([, n]) => n);
    const lead = counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    const acres = sites.reduce((t, c) => t + (c.lotSf ?? 0), 0) / 43560;
    return {
      id,
      name: sites[0].portfolioName ?? "Portfolio",
      sites: sites.length,
      markets: new Set(sites.map((c) => c.market).filter(Boolean)).size,
      stage: lead,
      stageMix: counts.length > 1 ? counts.map(([st, n]) => `${n} ${STAGE_LABELS[st]}`).join(", ") : null,
      acres,
      price: sites.reduce((t, c) => t + ask(c), 0),
    };
  });
  const totalShown = singles.length + packages.length;

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
              <a href="/deals/new" className="btn-inverse">New Deal</a>
            </div>
          </div>
          <div className="ph-kpis">
            <DarkKpi
              label="Active deals"
              value={active.length}
              sub={(() => {
                const pk = new Set(active.map((c) => c.portfolioId).filter(Boolean));
                return pk.size ? `${active.filter((c) => c.portfolioId).length} in ${pk.size} portfolio${pk.size === 1 ? "" : "s"}` : undefined;
              })()}
            />
            <DarkKpi
              label="Pipeline value"
              value={fmtMoney(value)}
              sub={priced < active.length ? `${active.length - priced} unpriced` : undefined}
            />
            <DarkKpi label="Avg site score" value={avgScore ?? "—"} sub={`${scored.length} of ${active.length} scored`} />
            <DarkKpi label="To IC this week" value={toIc} />
          </div>
        </div>

        <DealFilters
          state={state}
          pipelines={[
            ...ASSET_CLASSES.map((c) => ({ value: c, label: ASSET_CLASS_LABELS[c] })),
            { value: "all", label: "All pipelines" },
          ]}
          markets={marketOptions}
          stages={stageOptions}
          sorts={Object.entries(SORTS).map(([value, label]) => ({ value, label }))}
          owners={ownerOptions}
          shown={totalShown}
          total={cards.length}
        />

        {view === "cards" ? (
          totalShown ? (
            <>
              {packages.length > 0 && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "18px 28px 0" }}>
                  {packages.map((p) => <PackageCard key={p.id} p={p} />)}
                </div>
              )}
              {singles.length > 0 && <DealGrid cards={singles} />}
            </>
          ) : (
            <p className="empty-state">No deals match these filters.</p>
          )
        ) : (
          <div style={{ padding: "18px 28px 40px" }}>
            <div className="pipeline-board pipeline-board-6">
              {(stages.length ? ACQUISITION_STAGES.filter((s) => stages.includes(s)) : ACQUISITION_STAGES).map((s) => {
                const col = singles.filter((c) => c.stage === s);
                const colPackages = packages.filter((p) => p.stage === s);
                return (
                  <section key={s} className="pipeline-column">
                    <h2>
                      {STAGE_LABELS[s]}
                      <span className="count">{col.length + colPackages.length}</span>
                    </h2>
                    <div className="pipeline-cards">
                      {colPackages.map((p) => <PackageCard key={p.id} p={p} />)}
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
                      {col.length + colPackages.length === 0 && <p className="empty">Nothing here</p>}
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

interface PortfolioCard {
  id: string;
  name: string;
  sites: number;
  markets: number;
  stage: string;
  /** "12 Prospect, 2 UW" when the sites aren't all at one stage. */
  stageMix: string | null;
  acres: number;
  price: number;
}

/** One card for a whole portfolio package; its sites are on the portfolio page. */
function PackageCard({ p }: { p: PortfolioCard }) {
  return (
    <div className="pipeline-card-wrap">
      <a href={`/deals/portfolios/${p.id}`} className="pipeline-card" style={{ borderLeft: "4px solid #0E5AA7" }}>
        <span className="address">{p.name}</span>
        <span className="market muted">
          Portfolio · {p.sites} site{p.sites === 1 ? "" : "s"} · {p.markets} market{p.markets === 1 ? "" : "s"}
        </span>
        <span className="stage-age">
          {[p.acres ? `${p.acres.toFixed(1)} ac` : null, p.price ? fmtMoney(p.price) : "Unpriced"].filter(Boolean).join(" · ")}
        </span>
        {p.stageMix && <span className="stage-age">{p.stageMix}</span>}
      </a>
      <CardDeleteButton portfolio={{ id: p.id, sites: p.sites }} />
    </div>
  );
}
