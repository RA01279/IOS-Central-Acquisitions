import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import { STAGE_LABELS } from "@/lib/deals";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import { BarRows, Columns, SERIES, SERIES_SOFT, Stat } from "@/components/charts";
import { ctToday } from "@/lib/summary";
import { fetchAll } from "@/lib/fetch-all";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

// Targets: deals we lost or that aren't for sale yet, scored 1-5 with a
// follow-up date. Reads top to bottom: headline tiles, the follow-up calendar
// and the score / reason / market mix, what's due now, then every target
// (filterable by score, the top 40 until asked).

const DISPOSITION_LABELS: Record<string, string> = {
  lost: "Lost",
  not_selling: "Not selling (yet)",
  passed: "We passed",
  other: "Other",
};
const LIST_PAGE = 40;

function stars(score: number | null) {
  if (!score) return null;
  return "★".repeat(score) + "☆".repeat(5 - score);
}
const addMonths = (ym: string, n: number) => { const d = new Date(`${ym}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const monthLabel = (ym: string) => new Date(`${ym}-01T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short" });
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

export default async function TargetsPage(
  props: {
    searchParams: Promise<{ all?: string; score?: string; more?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const showAll = searchParams.all === "1";
  const scoreFilter = ["1", "2", "3", "4", "5", "none"].includes(searchParams.score ?? "") ? searchParams.score! : null;
  const supabase = getServiceClient();

  // Paged: archived deals are the largest set and grow fastest.
  const deals = await fetchAll((f, t) => {
    let query = supabase
      .from("deals")
      .select(
        "id, disposition, pursuit_score, follow_up_on, death_stage, death_reason, created_at, properties(address, city, market), offers(price, offered_at)"
      )
      .eq("deal_type", "acquisition")
      .eq("stage", "archived");
    if (!showAll) {
      query = query.or("disposition.not.is.null,pursuit_score.not.is.null,follow_up_on.not.is.null");
    }
    return query.order("id").range(f, t);
  });

  const today = ctToday();
  // 0-star = "never a target": permanently excluded from the target lists
  // (still browsable via the Show-entire-archive toggle).
  const all = (deals ?? []).filter((d: any) => showAll || d.pursuit_score !== 0);
  const live = all.filter((d: any) => d.pursuit_score !== 0);

  const due = live
    .filter((d: any) => d.follow_up_on && d.follow_up_on <= today)
    .sort((a: any, b: any) => (b.pursuit_score ?? 0) - (a.pursuit_score ?? 0) || (a.follow_up_on ?? "").localeCompare(b.follow_up_on ?? ""));
  const dueIds = new Set(due.map((d: any) => d.id));
  const next30 = live.filter((d: any) => d.follow_up_on && d.follow_up_on > today && daysBetween(today, d.follow_up_on) <= 30).length;
  const top = live.filter((d: any) => (d.pursuit_score ?? 0) >= 4).length;
  const withOffer = live.filter((d: any) => (d.offers ?? []).some((o: any) => o.price)).length;

  const rest = all
    .filter((d: any) => !dueIds.has(d.id))
    .filter((d: any) => !scoreFilter || (scoreFilter === "none" ? !d.pursuit_score : String(d.pursuit_score) === scoreFilter))
    .sort(
      (a: any, b: any) =>
        (b.pursuit_score ?? 0) - (a.pursuit_score ?? 0) ||
        (a.follow_up_on ?? "9999").localeCompare(b.follow_up_on ?? "9999")
    );
  const showMore = searchParams.more === "1" || rest.length <= LIST_PAGE + 10;
  const listed = showMore ? rest : rest.slice(0, LIST_PAGE);

  // Follow-ups over the next six months (4-5 stars vs the rest).
  const thisMonth = today.slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => addMonths(thisMonth, i));
  const calendar = months.map((ym) => {
    const list = live.filter((d: any) => d.follow_up_on && d.follow_up_on.slice(0, 7) === ym && d.follow_up_on > today);
    const hi = list.filter((d: any) => (d.pursuit_score ?? 0) >= 4).length;
    return {
      key: ym,
      label: monthLabel(ym),
      muted: list.length === 0,
      title: `${monthLabel(ym)}: ${list.length} follow-ups (${hi} rated 4-5 stars)`,
      segments: [
        { value: hi, color: SERIES[0], title: `${hi} rated 4-5 stars` },
        { value: list.length - hi, color: SERIES_SOFT, title: `${list.length - hi} other` },
      ],
    };
  });

  const count = <T,>(keys: T[], of: (d: any) => T) => keys.map((k) => ({ k, n: live.filter((d: any) => of(d) === k).length }));
  const byScore = count([5, 4, 3, 2, 1, null], (d) => d.pursuit_score ?? null);
  const byDisposition = count(["not_selling", "lost", "passed", "other", null], (d) => d.disposition ?? null).filter((x) => x.n);
  const marketNames = [...new Set(live.map((d: any) => d.properties?.market?.trim()).filter(Boolean))] as string[];
  const byMarket = marketNames.map((m) => ({ m, n: live.filter((d: any) => d.properties?.market?.trim() === m).length })).sort((a, b) => b.n - a.n).slice(0, 8);

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ all: showAll ? "1" : null, score: scoreFilter, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `/targets${s ? `?${s}` : ""}`;
  };

  function TargetTable({ rows, overdue }: { rows: any[]; overdue?: boolean }) {
    return (
      <div className="table-scroll">
        <table className="summary-table log-table">
          <thead>
            <tr>
              <th>Score</th>
              <th>Property</th>
              <th>Market</th>
              <th>Why</th>
              <th>Follow up</th>
              <th className="num">Last offer</th>
              <th>Died at</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d: any) => {
              const lastOffer = [...(d.offers ?? [])].sort((a: any, b: any) => (b.offered_at ?? "").localeCompare(a.offered_at ?? ""))[0];
              const late = d.follow_up_on && d.follow_up_on <= today ? daysBetween(d.follow_up_on, today) : null;
              return (
                <tr key={d.id}>
                  <td>{d.pursuit_score ? <span className="target-stars">{stars(d.pursuit_score)}</span> : <span className="muted">unscored</span>}</td>
                  <td>
                    <Link href={`/deals/${d.id}`}><strong>{d.properties?.address ?? "Untitled"}</strong></Link>
                    {d.properties?.city ? <span className="muted"> · {d.properties.city}</span> : null}
                  </td>
                  <td>{d.properties?.market ?? "—"}</td>
                  <td>{d.disposition ? <span className="badge2 neutral">{DISPOSITION_LABELS[d.disposition] ?? d.disposition}</span> : "—"}</td>
                  <td>
                    {d.follow_up_on ? (
                      <>
                        {shortDate(d.follow_up_on)}
                        {overdue && late != null ? <span className={late > 30 ? "overdue" : "muted"}> · {late === 0 ? "today" : `${late}d late`}</span> : null}
                      </>
                    ) : "—"}
                  </td>
                  <td className="num">{lastOffer?.price ? `$${Math.round(lastOffer.price).toLocaleString()}` : "—"}</td>
                  <td className="muted">{d.death_stage ? STAGE_LABELS[d.death_stage] ?? d.death_stage : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <Nav active="targets" />
      <AutoRefresh />
      <main className="wide">
        <div className="page-header">
          <div>
            <h1>Targets</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              Deals we lost or that aren&apos;t for sale yet — scored, with follow-up dates.
            </p>
          </div>
          <div className="header-actions">
            {showAll ? (
              <Link href="/targets" className="button-link">Scored only</Link>
            ) : (
              <Link href="/targets?all=1" className="button-link">Show entire archive</Link>
            )}
          </div>
        </div>

        <div className="stat-grid-auto">
          <Stat label="Targets" value={live.length} sub={`${withOffer} we've offered on`} />
          <Stat label="Follow-up due now" value={due.length} bad={due.length > 0} />
          <Stat label="Due in the next 30 days" value={next30} />
          <Stat label="Rated 4-5 stars" value={top} href={href({ score: "5", more: null })} />
        </div>

        <div className="two-col">
          <section className="panel">
            <h2>Follow-ups coming up</h2>
            <div className="viz-legend">
              <span className="viz-legend-item"><span className="viz-swatch" style={{ background: SERIES[0] }} />Rated 4-5 stars</span>
              <span className="viz-legend-item"><span className="viz-swatch" style={{ background: SERIES_SOFT }} />Other targets</span>
            </div>
            <Columns cols={calendar} height={130} />
          </section>
          <section className="panel">
            <h2>By score</h2>
            <BarRows
              labelWidth={110}
              rows={byScore.map(({ k, n }) => ({
                key: String(k),
                label: k ? <span className="target-stars">{stars(k)}</span> : "Unscored",
                href: href({ score: k ? String(k) : "none", more: null }),
                segments: [{ value: n, color: k && k >= 4 ? SERIES[0] : SERIES_SOFT }],
                value: n,
              }))}
            />
          </section>
        </div>

        <div className="two-col">
          <section className="panel">
            <h2>Why they&apos;re on the list</h2>
            <BarRows
              labelWidth={140}
              rows={byDisposition.map(({ k, n }) => ({ key: String(k), label: k ? DISPOSITION_LABELS[k] ?? k : "Not recorded", segments: [{ value: n, color: "var(--n400)" }], value: n }))}
            />
          </section>
          <section className="panel">
            <h2>Top markets</h2>
            {byMarket.length ? (
              <BarRows labelWidth={140} rows={byMarket.map(({ m, n }) => ({ key: m, label: m, segments: [{ value: n, color: SERIES_SOFT }], value: n }))} />
            ) : <p className="hint">No markets recorded.</p>}
          </section>
        </div>

        <section className="panel">
          <h2>Due for follow-up <span className="count">{due.length}</span></h2>
          {due.length === 0 ? (
            <p className="muted">Nothing due. Set follow-up dates from any archived deal&apos;s Target scoring panel.</p>
          ) : (
            <TargetTable rows={due} overdue />
          )}
        </section>

        <section className="panel">
          <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ margin: 0 }}>{showAll ? "All archived acquisitions" : "Scored targets"} <span className="count">{rest.length}</span></h2>
            <div className="filter-chips" style={{ margin: 0 }}>
              <Link href={href({ score: null, more: null })} className={!scoreFilter ? "chip chip-active" : "chip"}>Any score</Link>
              {["5", "4", "3", "2", "1"].map((s) => (
                <Link key={s} href={href({ score: s, more: null })} className={scoreFilter === s ? "chip chip-active" : "chip"}>{s}★</Link>
              ))}
              <Link href={href({ score: "none", more: null })} className={scoreFilter === "none" ? "chip chip-active" : "chip"}>Unscored</Link>
            </div>
          </div>
          {rest.length === 0 ? (
            <p className="muted">
              No targets here. Open a deal from the <Link href="/targets?all=1">archive</Link> and use its Target scoring panel.
            </p>
          ) : (
            <TargetTable rows={listed} />
          )}
          {!showMore ? (
            <p style={{ textAlign: "center", margin: "12px 0 0" }}>
              <Link href={href({ more: "1" })} className="tchip">Show all {rest.length}</Link>
            </p>
          ) : null}
        </section>
      </main>
    </>
  );
}
