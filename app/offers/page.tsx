import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import { ASSET_CLASSES, ASSET_CLASS_LABELS, STAGE_LABELS } from "@/lib/deals";
import { ctToday, isRangeKey, RANGE_KEYS, RANGE_LABELS, rangeStart } from "@/lib/summary";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import { BarRows, Columns, Legend, SERIES, SERIES_SOFT, Stat } from "@/components/charts";
import { OFFER_STATUSES, OFFER_STATUS_LABELS, bidAskGap } from "@/lib/offer-status";
import { fetchAll } from "@/lib/fetch-all";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

// The offer log maintains itself. Every offer reaches this page one of two
// ways, and neither is "someone remembers to update a spreadsheet":
//   * manual -- the Log offer button on a deal
//   * loi    -- recorded automatically when an LOI is generated at a price
// See recordOffer() in lib/deals.ts.
//
// Layout: headline tiles, then three charts (offers over time by asset class,
// where they stand, busiest markets), then the log itself -- the latest 25
// until asked for the rest.

const LOG_PAGE = 25;

function fmtUsd(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `$${Math.round(v).toLocaleString()}`;
}
const short = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v > 0 ? `$${Math.round(v / 1e3).toLocaleString()}K` : "$0");
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

// Offer status chart colours: our offer still out is the brand blue; the
// seller's answers are labelled, so the bars can share one neutral.
const STAGE_ORDER = ["closed", "due_diligence", "moving_to_psa", "offered", "uw", "prospect", "archived"];
const ADVANCED = new Set(["moving_to_psa", "due_diligence", "closed"]);
const STATUS_COLOR: Record<string, string> = { sent: "var(--series-1)", countered: "var(--series-2)", accepted: "var(--strong)" };

export default async function OffersPage(
  props: {
    searchParams: Promise<{ asset?: string; range?: string; all?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const assetParam = searchParams.asset;
  const asset =
    assetParam && (ASSET_CLASSES as readonly string[]).includes(assetParam) ? assetParam : "all";
  const range = isRangeKey(searchParams.range) ? searchParams.range : "ytd";
  const today = ctToday();
  const start = rangeStart(range, today);

  const supabase = getServiceClient();
  // Paged: a YTD offer log passes 1000 rows within the year.
  const data = await fetchAll((f, t) => supabase
    .from("offers")
    .select(
      "id, price, offered_at, notes, source, status, counter_price, responded_on, created_by, created_at, deals(id, deal_type, stage, asset_class, properties(address, city, market, lot_sf))"
    )
    .gte("offered_at", start)
    .order("offered_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id")
    .range(f, t));

  const rows = (data ?? []).filter((o: any) => {
    if (!o.deals || o.deals.deal_type === "lease") return false;
    if (asset !== "all" && o.deals.asset_class !== asset) return false;
    return true;
  });

  const sum = (list: any[]) => list.reduce((t: number, o: any) => t + (o.price ?? 0), 0);
  const totals = { count: rows.length, value: sum(rows) };
  const priced = rows.filter((o: any) => o.price);
  const dealCount = new Set(rows.map((o: any) => o.deals.id)).size;
  // Where the window's offers ended up, and how far apart we were when countered.
  const statusCounts = OFFER_STATUSES.map((st) => [st, rows.filter((o: any) => (o.status ?? "sent") === st).length] as const).filter(([, n]) => n > 0);
  const gaps = rows.map((o: any) => bidAskGap(o.price, o.counter_price)?.pct).filter((v): v is number => v != null).sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const accepted = rows.filter((o: any) => o.status === "accepted").length;
  // Where the offered deals stand today (each deal once), furthest along first.
  const dealStage = new Map<string, string>(rows.map((o: any) => [o.deals.id, o.deals.stage]));
  const dealStages = STAGE_ORDER.map((st) => ({ st, n: [...dealStage.values()].filter((s) => s === st).length })).filter((x) => x.n);
  const psaPlus = [...dealStage.values()].filter((s) => ADVANCED.has(s)).length;
  const psfs = rows
    .map((o: any) => (o.price && o.deals.properties?.lot_sf ? o.price / o.deals.properties.lot_sf : null))
    .filter((v: number | null): v is number => v != null)
    .sort((a: number, b: number) => a - b);
  const medianPsf = psfs.length ? psfs[Math.floor(psfs.length / 2)] : null;
  const classes = asset === "all" ? [...ASSET_CLASSES] : [asset];
  const classColor = (ac: string) => SERIES[Math.max(0, (ASSET_CLASSES as readonly string[]).indexOf(ac))] ?? SERIES[0];

  // Offers over time: days for a week, weeks for a month, months for a year.
  const buckets: { key: string; from: string; to: string; label: string; sub?: string }[] = [];
  if (range === "7d") {
    for (let i = 0; i < 7; i++) { const d = addDays(start, i); buckets.push({ key: d, from: d, to: d, label: fmtDay(d, { weekday: "short" }), sub: fmtDay(d, { month: "short", day: "numeric" }) }); }
  } else if (range === "mtd") {
    for (let d = start; d <= today; d = addDays(d, 7)) { const to = addDays(d, 6); buckets.push({ key: d, from: d, to, label: fmtDay(d, { month: "short", day: "numeric" }) }); }
  } else {
    for (let m = 1; m <= Number(today.slice(5, 7)); m++) {
      const mm = String(m).padStart(2, "0");
      const from = `${today.slice(0, 4)}-${mm}-01`;
      buckets.push({ key: from, from, to: `${today.slice(0, 4)}-${mm}-31`, label: fmtDay(from, { month: "short" }) });
    }
  }
  const timeCols = buckets.map((b) => {
    const inB = rows.filter((o: any) => o.offered_at && o.offered_at >= b.from && o.offered_at <= b.to);
    return {
      key: b.key,
      label: b.label,
      sub: b.sub ?? (inB.length ? short(sum(inB)) : undefined),
      muted: inB.length === 0,
      title: `${b.label}${b.sub ? ` ${b.sub}` : ""}: ${inB.length} offers, ${short(sum(inB))}`,
      segments: classes.map((ac) => {
        const n = inB.filter((o: any) => o.deals.asset_class === ac).length;
        return { value: n, color: classColor(ac), title: `${ASSET_CLASS_LABELS[ac]}: ${n}` };
      }),
    };
  });

  // Busiest markets in the window.
  const marketNames = [...new Set(rows.map((o: any) => o.deals.properties?.market?.trim()).filter(Boolean))] as string[];
  const markets = marketNames
    .map((m) => ({ m, list: rows.filter((o: any) => o.deals.properties?.market?.trim() === m) }))
    .sort((a, b) => b.list.length - a.list.length)
    .slice(0, 8);

  const showAll = searchParams.all === "1" || rows.length <= LOG_PAGE + 10;
  const logRows = showAll ? rows : rows.slice(0, LOG_PAGE);
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | null> = { range, asset: asset !== "all" ? asset : null, ...patch };
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    return `/offers?${p.toString()}`;
  };
  const csvHref = `/api/offers/csv?range=${range}${asset !== "all" ? `&asset=${asset}` : ""}`;

  return (
    <>
      <Nav active="offers" />
      <AutoRefresh />
      <main className="wide">
        <div className="page-header">
          <div>
            <h1>Offer log</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              Every offer submitted, logged automatically when an LOI is generated. {start} to{" "}
              {today}.
            </p>
          </div>
          <div className="header-actions">
            <a href={csvHref} className="button-link">
              Download CSV
            </a>
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-chips" style={{ margin: 0 }}>
            {RANGE_KEYS.map((k) => (
              <Link key={k} href={qs({ range: k })} className={k === range ? "chip chip-active" : "chip"}>
                {RANGE_LABELS[k]}
              </Link>
            ))}
          </div>
          <div className="filter-chips" style={{ margin: 0 }}>
            <Link href={qs({ asset: null })} className={asset === "all" ? "chip chip-active" : "chip"}>
              All asset classes
            </Link>
            {ASSET_CLASSES.map((c) => (
              <Link key={c} href={qs({ asset: c })} className={asset === c ? "chip chip-active" : "chip"}>
                {ASSET_CLASS_LABELS[c]}
              </Link>
            ))}
          </div>
        </div>

        <div className="stat-grid-auto">
          <Stat label="Offers submitted" value={totals.count} sub={`across ${dealCount} deals`} />
          <Stat label="Total offered" value={short(totals.value)} />
          <Stat label="Average offer" value={priced.length ? short(totals.value / priced.length) : "—"} />
          <Stat label="Median $/SF land" value={medianPsf != null ? `$${medianPsf.toFixed(2)}` : "—"} sub={psfs.length ? `${psfs.length} offers with a lot size` : undefined} />
          <Stat label="Went to PSA or further" value={psaPlus} sub={dealCount ? `${Math.round((psaPlus / dealCount) * 100)}% of deals offered on` : undefined} />
          {gaps.length || accepted ? (
            <Stat label="Countered / accepted" value={`${gaps.length} / ${accepted}`} sub={medianGap != null ? `median ask ${(medianGap * 100).toFixed(1)}% above us` : undefined} />
          ) : null}
        </div>

        {rows.length > 0 ? (
          <>
            <section className="panel">
              <h2>Offers {range === "7d" ? "by day" : range === "mtd" ? "by week" : "by month"}</h2>
              <Legend items={classes.map((ac) => ({ label: `${ASSET_CLASS_LABELS[ac]} · ${rows.filter((o: any) => o.deals.asset_class === ac).length} · ${short(sum(rows.filter((o: any) => o.deals.asset_class === ac)))}`, color: classColor(ac) }))} />
              <Columns cols={timeCols} height={150} />
            </section>

            <div className="two-col">
              <section className="panel">
                <h2>Where those deals are now</h2>
                <BarRows
                  labelWidth={130}
                  rows={dealStages.map(({ st, n }) => ({
                    key: st,
                    label: STAGE_LABELS[st] ?? st,
                    segments: [{ value: n, color: st === "archived" ? "var(--n400)" : ADVANCED.has(st) ? SERIES[0] : SERIES_SOFT }],
                    value: <>{n} <span className="muted">· {Math.round((n / dealCount) * 100)}%</span></>,
                  }))}
                />
                {statusCounts.length > 1 ? (
                  <>
                    <h3 className="report-sub">Seller responses</h3>
                    <BarRows
                      labelWidth={130}
                      rows={statusCounts.map(([st, n]) => ({
                        key: st,
                        label: OFFER_STATUS_LABELS[st],
                        segments: [{ value: n, color: STATUS_COLOR[st] ?? "var(--n400)" }],
                        value: <>{n} <span className="muted">· {Math.round((n / totals.count) * 100)}%</span></>,
                      }))}
                    />
                  </>
                ) : null}
                {medianGap != null ? (
                  <p className="hint" style={{ marginBottom: 0 }}>
                    When a seller countered, their number was a median {(medianGap * 100).toFixed(1)}% above our offer ({gaps.length} countered).
                  </p>
                ) : null}
              </section>
              <section className="panel">
                <h2>Busiest markets</h2>
                {markets.length ? (
                  <>
                    {classes.length > 1 ? <Legend items={classes.map((ac) => ({ label: ASSET_CLASS_LABELS[ac], color: classColor(ac) }))} /> : null}
                    <BarRows
                      labelWidth={120}
                      rows={markets.map(({ m, list }) => ({
                        key: m,
                        label: m,
                        title: `${m}: ${list.length} offers, ${short(sum(list))}`,
                        segments: classes.map((ac) => ({ value: list.filter((o: any) => o.deals.asset_class === ac).length, color: classColor(ac) })),
                        value: <>{list.length} <span className="muted">· {short(sum(list))}</span></>,
                      }))}
                    />
                  </>
                ) : <p className="hint">No markets recorded on these deals.</p>}
              </section>
            </div>
          </>
        ) : null}

        <section className="panel">
          <h2>
            {showAll ? "All offers" : `Latest ${LOG_PAGE} offers`} <span className="count">{totals.count}</span>
          </h2>
          {rows.length === 0 ? (
            <p className="muted">
              No offers dated inside this window. Log one from a deal, or generate an LOI — that
              records the offer for you.
            </p>
          ) : (
            <div className="table-scroll">
            <table className="summary-table log-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Property</th>
                  <th>Market</th>
                  <th>Class</th>
                  <th className="num">Price</th>
                  <th className="num">$/SF land</th>
                  <th>Status</th>
                  <th className="num">Counter</th>
                  <th>Stage</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {logRows.map((o: any) => {
                  const lotSf = o.deals.properties?.lot_sf;
                  const psf = o.price && lotSf ? o.price / lotSf : null;
                  const status = o.status ?? "sent";
                  return (
                    <tr key={o.id}>
                      <td>{o.offered_at ?? "—"}</td>
                      <td>
                        <Link href={`/deals/${o.deals.id}`}>
                          {o.deals.properties?.address ?? "Untitled deal"}
                        </Link>
                      </td>
                      <td>{o.deals.properties?.market ?? "—"}</td>
                      <td>{ASSET_CLASS_LABELS[o.deals.asset_class] ?? "—"}</td>
                      <td className="num">{fmtUsd(o.price)}</td>
                      <td className="num">{psf === null ? "—" : `$${psf.toFixed(2)}`}</td>
                      <td>
                        <span className={`badge2 ${status === "accepted" ? "success" : status === "countered" ? "warning" : status === "rejected" ? "danger" : "neutral"}`}>
                          {OFFER_STATUS_LABELS[status] ?? status}
                        </span>
                      </td>
                      <td className="num">
                        {o.counter_price ? (
                          <>
                            {fmtUsd(o.counter_price)}
                            {(() => { const g = bidAskGap(o.price, o.counter_price); return g ? <span className="muted"> +{(g.pct * 100).toFixed(1)}%</span> : null; })()}
                          </>
                        ) : "—"}
                      </td>
                      <td>{STAGE_LABELS[o.deals.stage] ?? o.deals.stage}</td>
                      <td>
                        <span className="doc-type">{o.source === "loi" ? "LOI" : "MANUAL"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
          {!showAll ? (
            <p style={{ textAlign: "center", margin: "12px 0 0" }}>
              <Link href={qs({ all: "1" })} className="tchip">Show all {rows.length} offers</Link>
            </p>
          ) : null}
        </section>
      </main>
    </>
  );
}
