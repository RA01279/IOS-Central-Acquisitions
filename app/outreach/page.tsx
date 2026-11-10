// app/outreach/page.tsx
//
// Off-market owner outreach: every open off-market prospect (added from the
// Sourcing tool or by hand) as a work queue -- who's due a follow-up today,
// who hasn't been contacted, who's warm -- with click-to-call owner details
// and a log-a-touch form that sets the next reminder (components/OutreachQueue).
// Data: lib/outreach-db.ts loadOutreach.

import Link from "next/link";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import OutreachQueue from "@/components/OutreachQueue";
import { BarRows, Columns, SERIES, SERIES_SOFT, Stat } from "@/components/charts";
import { loadOutreach } from "@/lib/outreach-db";
import { STATUS_LABELS, type OutreachStatus } from "@/lib/outreach";
import { ctToday } from "@/lib/summary";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outreach" };

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const ctDate = (ts: string) => new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const STATUS_ORDER: OutreachStatus[] = ["new", "reaching_out", "talking", "interested", "later", "bad_contact", "not_selling"];

export default async function OutreachPage(props: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await props.searchParams;
  const today = ctToday();
  const rows = await loadOutreach();

  const due = rows.filter((r) => r.nextOn && r.nextOn <= today && r.status !== "not_selling").length;
  const fresh = rows.filter((r) => r.status === "new").length;
  const warm = rows.filter((r) => r.status === "interested" || r.status === "talking").length;
  const weekAgo = addDays(today, -6);
  const touchesThisWeek = rows.reduce((n, r) => n + r.touches.filter((t) => ctDate(t.occurred_at) >= weekAgo).length, 0);
  const initialTab = (["due", "new", "upcoming", "nonext", "warm", "dead", "all"] as const).find((t) => t === sp.tab) ?? (due ? "due" : fresh ? "new" : "all");

  // Touches per week, the last eight weeks (Monday-start weeks ending this week).
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const thisMonday = addDays(today, -dow);
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(thisMonday, -7 * (7 - i)));
  const all = rows.flatMap((r) => r.touches.map((t) => ({ day: ctDate(t.occurred_at), spoke: t.outcome === "spoke" || t.outcome === "interested" })));
  const weekCols = weeks.map((w) => {
    const list = all.filter((t) => t.day >= w && t.day <= addDays(w, 6));
    const spoke = list.filter((t) => t.spoke).length;
    const label = new Date(`${w}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
    return {
      key: w, label, muted: list.length === 0,
      title: `Week of ${label}: ${list.length} touches, ${spoke} conversations`,
      segments: [
        { value: spoke, color: SERIES[0], title: `${spoke} reached the owner` },
        { value: list.length - spoke, color: SERIES_SOFT, title: `${list.length - spoke} other touches` },
      ],
    };
  });
  const byStatus = STATUS_ORDER.map((s) => ({ s, n: rows.filter((r) => r.status === s).length })).filter((x) => x.n);

  return (
    <>
      <Nav active="outreach" />
      <AutoRefresh />
      <main className="wide">
        <div className="page-header">
          <div>
            <h1>Outreach</h1>
            <p className="hint" style={{ margin: 0 }}>
              Off-market owners to work: log every call, email or letter and set the next touch. Add prospects from{" "}
              <Link href="/sourcing">Sourcing</Link> or mark any deal off-market.
            </p>
          </div>
        </div>

        <div className="stat-grid-auto">
          <Stat label="Off-market prospects" value={rows.length} />
          <Stat label="Follow-ups due" value={due} bad={due > 0} href="/outreach?tab=due#queue" />
          <Stat label="Not contacted yet" value={fresh} href="/outreach?tab=new#queue" />
          <Stat label="Touches this week" value={touchesThisWeek} />
          <Stat label="Interested / talking" value={warm} href="/outreach?tab=warm#queue" />
        </div>

        {rows.length ? (
          <div className="two-col">
            <section className="panel">
              <h2>Touches per week</h2>
              <div className="viz-legend">
                <span className="viz-legend-item"><span className="viz-swatch" style={{ background: SERIES[0] }} />Reached the owner</span>
                <span className="viz-legend-item"><span className="viz-swatch" style={{ background: SERIES_SOFT }} />Other touches</span>
              </div>
              <Columns cols={weekCols} height={110} />
            </section>
            <section className="panel">
              <h2>Where prospects stand</h2>
              <BarRows
                labelWidth={130}
                rows={byStatus.map(({ s, n }) => ({
                  key: s, label: STATUS_LABELS[s],
                  segments: [{ value: n, color: s === "interested" || s === "talking" ? SERIES[0] : s === "not_selling" ? "var(--n400)" : SERIES_SOFT }],
                  value: n,
                }))}
              />
            </section>
          </div>
        ) : null}

        {rows.length ? (
          <OutreachQueue rows={rows} today={today} initialTab={initialTab} />
        ) : (
          <section className="panel">
            <p className="hint">
              No off-market prospects yet. Run a sweep in <Link href="/sourcing">Sourcing</Link> and use &ldquo;Add as prospect&rdquo;, or set a deal&apos;s marketing to off-market.
            </p>
          </section>
        )}
      </main>
    </>
  );
}
