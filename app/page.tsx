import Link from "next/link";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import {
  buildSummary,
  isRangeKey,
  MILESTONE_LABELS,
  RANGE_KEYS,
  RANGE_LABELS,
  VALUE_BASIS_LABELS,
  type ClassSplit,
  type RangeKey,
  type ValueRollup,
} from "@/lib/summary";
import { ASSET_CLASSES, ASSET_CLASS_LABELS, STAGE_LABELS } from "@/lib/deals";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

function fmtMoney(v: number): string {
  if (!v) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

// A money subtotal never appears without saying how firm it is. Deals priced
// off their last offer, or carrying no price at all, are called out -- a
// half-estimated total quoted as fact is worse than no total.
function moneyCaveat(money: ValueRollup): string | null {
  const parts: string[] = [];
  if (money.estimated > 0) parts.push(`${money.estimated} at last offer`);
  if (money.missing > 0) parts.push(`${money.missing} unpriced`);
  return parts.length ? parts.join(" · ") : null;
}

function SplitTile({
  value,
  label,
  split,
  href,
  sub,
}: {
  value: number;
  label: string;
  split: ClassSplit;
  href: string;
  sub?: string;
}) {
  return (
    <Link href={href} className="stat-tile">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      <span className="stat-delta">
        {ASSET_CLASS_LABELS.ios} {split.ios} · {ASSET_CLASS_LABELS.industrial} {split.industrial}
      </span>
      {sub && <span className="stat-label">{sub}</span>}
    </Link>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  const range: RangeKey = isRangeKey(searchParams.range) ? searchParams.range : "7d";
  const s = await buildSummary(range);

  // Rows of the bifurcated roll-up: one per asset class, then the total.
  const columns: { key: string; label: string; split: ClassSplit }[] = [
    { key: "prospect", label: STAGE_LABELS.prospect, split: s.standing.prospect },
    { key: "uw", label: STAGE_LABELS.uw, split: s.standing.uw },
    { key: "offered", label: STAGE_LABELS.offered, split: s.standing.offered },
    { key: "in_contract", label: "In contract", split: s.inContract.count },
    { key: "closed", label: "Closed", split: s.closed.count },
  ];

  const overdueMilestones = s.upcoming.filter((m) => m.daysAway < 0);

  return (
    <>
      <Nav active="home" />
      <AutoRefresh />
      <main>
        <div className="page-header">
          <div>
            <h1>Central Acquisitions</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {RANGE_LABELS[range]} — {s.rangeStart} to {s.today} · stage counts are current, not
              range-scoped
            </p>
          </div>
        </div>

        <div className="filter-chips">
          {RANGE_KEYS.map((k) => (
            <Link
              key={k}
              href={k === "7d" ? "/" : `/?range=${k}`}
              className={k === range ? "chip chip-active" : "chip"}
            >
              {RANGE_LABELS[k]}
            </Link>
          ))}
        </div>

        <div className="stat-grid">
          <SplitTile
            value={s.newProspects.total}
            label={`New prospects · ${RANGE_LABELS[range].toLowerCase()}`}
            split={s.newProspects}
            href="/deals"
            sub={`${s.standing.prospect.total} sitting at Prospect now`}
          />
          <SplitTile
            value={s.underwritten.total}
            label={`Deals underwritten · ${RANGE_LABELS[range].toLowerCase()}`}
            split={s.underwritten}
            href="/deals"
            sub={`${s.standing.uw.total} in UW now`}
          />
          <SplitTile
            value={s.offersSubmitted.total}
            label={`Offers submitted · ${RANGE_LABELS[range].toLowerCase()}`}
            split={s.offersSubmitted}
            href="/offers"
            sub={`${fmtMoney(s.offersValue.total)} offered`}
          />
          <SplitTile
            value={s.inContract.count.total}
            label="In contract now"
            split={s.inContract.count}
            href="/deals"
            sub={
              moneyCaveat(s.inContract.money)
                ? `${fmtMoney(s.inContract.money.value.total)} · ${moneyCaveat(s.inContract.money)}`
                : `${fmtMoney(s.inContract.money.value.total)} at contract`
            }
          />
        </div>

        <section className="panel">
          <h2>
            Pipeline by asset class{" "}
            <Link href="/deals" className="muted panel-link">
              board →
            </Link>
          </h2>
          <table className="summary-table">
            <thead>
              <tr>
                <th />
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ASSET_CLASSES.map((ac) => (
                <tr key={ac}>
                  <th scope="row">
                    <Link href={`/deals?asset=${ac}`}>{ASSET_CLASS_LABELS[ac]}</Link>
                  </th>
                  {columns.map((c) => (
                    <td key={c.key}>{c.split[ac]}</td>
                  ))}
                </tr>
              ))}
              <tr className="summary-total">
                <th scope="row">Total</th>
                {columns.map((c) => (
                  <td key={c.key}>{c.split.total}</td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 10 }}>
            Prospect / UW / Offered / In contract are live stage counts. Closed counts closings
            dated inside {RANGE_LABELS[range].toLowerCase()}.
          </p>
        </section>

        {s.upcoming.length > 0 && (
          <section className="panel">
            <h2>
              Next 7 days — DD expirations &amp; closings{" "}
              <span className="count">{s.upcoming.length}</span>
            </h2>
            {overdueMilestones.length > 0 && (
              <p className="warning" style={{ marginTop: 0 }}>
                {overdueMilestones.length} date{overdueMilestones.length === 1 ? " has" : "s have"}{" "}
                already passed without the deal moving forward.
              </p>
            )}
            <ul className="doc-list">
              {s.upcoming.map((m) => (
                <li key={`${m.dealId}-${m.kind}`}>
                  <span className="doc-type">{ASSET_CLASS_LABELS[m.assetClass]}</span>
                  <Link href={`/deals/${m.dealId}`}>
                    <strong>{m.address ?? "Untitled deal"}</strong>
                  </Link>
                  <span className="muted">
                    {" "}
                    · {MILESTONE_LABELS[m.kind]}{" "}
                    <span className={m.daysAway <= 2 ? "overdue" : undefined}>{m.date}</span>{" "}
                    {m.daysAway < 0
                      ? `(${Math.abs(m.daysAway)}d overdue)`
                      : m.daysAway === 0
                        ? "(today)"
                        : `(in ${m.daysAway}d)`}
                    {" · "}
                    {STAGE_LABELS[m.stage] ?? m.stage}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="dash-cols">
          <section className="panel">
            <h2>
              In contract <span className="count">{s.inContract.count.total}</span>
            </h2>
            {s.inContract.deals.length === 0 ? (
              <p className="muted">Nothing under contract right now.</p>
            ) : (
              <>
                <ul className="doc-list">
                  {s.inContract.deals.map((d) => (
                    <li key={d.id}>
                      <span className="doc-type">{ASSET_CLASS_LABELS[d.assetClass]}</span>
                      <Link href={`/deals/${d.id}`}>
                        <strong>{d.address ?? "Untitled deal"}</strong>
                      </Link>
                      <span className="muted">
                        {" "}
                        · {STAGE_LABELS[d.stage] ?? d.stage}
                        {d.value
                          ? ` · ${fmtMoney(d.value)}${d.valueBasis === "last_offer" ? " (last offer)" : ""}`
                          : " · no price"}
                        {d.ddEndOn ? ` · DD to ${d.ddEndOn}` : ""}
                        {d.closingOn ? ` · closes ${d.closingOn}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="hint" style={{ marginTop: 10 }}>
                  {ASSET_CLASS_LABELS.ios} {s.inContract.count.ios} (
                  {fmtMoney(s.inContract.money.value.ios)}) · {ASSET_CLASS_LABELS.industrial}{" "}
                  {s.inContract.count.industrial} (
                  {fmtMoney(s.inContract.money.value.industrial)}) · Total{" "}
                  {s.inContract.count.total} ({fmtMoney(s.inContract.money.value.total)})
                  {moneyCaveat(s.inContract.money) ? ` — ${moneyCaveat(s.inContract.money)}` : ""}
                </p>
              </>
            )}
          </section>

          <section className="panel">
            <h2>
              Closed · {RANGE_LABELS[range].toLowerCase()}{" "}
              <span className="count">{s.closed.count.total}</span>
            </h2>
            {s.closed.deals.length === 0 ? (
              <p className="muted">No closings in this window.</p>
            ) : (
              <>
                <ul className="doc-list">
                  {s.closed.deals.map((d) => (
                    <li key={d.id}>
                      <span className="doc-type">{ASSET_CLASS_LABELS[d.assetClass]}</span>
                      <Link href={`/deals/${d.id}`}>
                        <strong>{d.address ?? "Untitled deal"}</strong>
                      </Link>
                      <span className="muted">
                        {" "}
                        {d.closedOn ? `· closed ${d.closedOn}` : ""}
                        {d.value
                          ? ` · ${fmtMoney(d.value)}${
                              d.valueBasis === "closed" ? "" : ` (${VALUE_BASIS_LABELS[d.valueBasis]})`
                            }`
                          : " · no price"}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="hint" style={{ marginTop: 10 }}>
                  {ASSET_CLASS_LABELS.ios} {s.closed.count.ios} (
                  {fmtMoney(s.closed.money.value.ios)}) · {ASSET_CLASS_LABELS.industrial}{" "}
                  {s.closed.count.industrial} ({fmtMoney(s.closed.money.value.industrial)}) · Total{" "}
                  {s.closed.count.total} ({fmtMoney(s.closed.money.value.total)})
                  {moneyCaveat(s.closed.money) ? ` — ${moneyCaveat(s.closed.money)}` : ""}
                </p>
              </>
            )}
          </section>
        </div>

        <p className="hint">
          Dollar figures use the actual closing price where a deal has closed, the agreed contract
          price where it's under contract, and the most recent offer otherwise — anything falling
          back to an offer is marked. Full operational detail (stale deals, where deals die,
          activity) is on the <Link href="/dashboard">dashboard</Link>.
        </p>
      </main>
    </>
  );
}
