"use client";
// components/ActivityChart.tsx
//
// Dashboard bar chart with switches: pipeline (All / IOS / Industrial),
// period (12 weeks / 12 months) and, when the events carry dollars, what to
// show (count or dollars). "All" stacks IOS under Industrial. Hover a bar for
// its breakdown; the line below compares the window with the one before it.

import { useMemo, useState } from "react";
import { bucketize, priorWindow, type Bucket, type Period, type Point } from "@/lib/activity-buckets";

type Pipe = "all" | "ios" | "industrial";
type Measure = "count" | "amount";

const IOS_COLOR = "var(--accent)";
const IND_COLOR = "var(--accent-2)";
const money = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <span role="group" aria-label={label} style={{ display: "inline-flex", gap: 2 }}>
      {options.map(([v, l]) => (
        <button key={v} type="button" className={value === v ? "tchip on" : "tchip"} aria-pressed={value === v} onClick={() => onChange(v)} style={{ padding: "2px 8px" }}>
          {l}
        </button>
      ))}
    </span>
  );
}

export default function ActivityChart({
  title,
  noun,
  points,
  today,
  hasAmounts = false,
}: {
  title: string;
  /** "offer" / "new deal" -- for the tooltip and summary. */
  noun: string;
  points: Point[];
  today: string;
  hasAmounts?: boolean;
}) {
  const [pipe, setPipe] = useState<Pipe>("all");
  const [period, setPeriod] = useState<Period>("week");
  const [measure, setMeasure] = useState<Measure>("count");
  const [hover, setHover] = useState<number | null>(null);

  const buckets = useMemo(() => bucketize(points, period, today), [points, period, today]);
  const prior = useMemo(() => priorWindow(points, period, today), [points, period, today]);

  const part = (b: Bucket, cls: "ios" | "industrial") => (pipe !== "all" && pipe !== cls ? 0 : measure === "count" ? b[cls].count : b[cls].amount);
  const total = (b: Bucket) => part(b, "ios") + part(b, "industrial");
  const sum = (bs: Bucket[]) => bs.reduce((t, b) => t + total(b), 0);
  const fmt = (v: number) => (measure === "count" ? String(v) : money(v));

  const W = 360, H = 120, top = 16, base = H - 22;
  const max = Math.max(1, ...buckets.map(total));
  const bw = W / buckets.length;
  const now = sum(buckets), before = sum(prior);
  const change = before ? (now - before) / before : null;
  const plural = (n: number) => `${noun}${n === 1 ? "" : "s"}`;
  const h = hover != null ? buckets[hover] : null;

  return (
    <section className="panel">
      <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>{title} · last 12 {period === "week" ? "weeks" : "months"}</h2>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "6px 0" }}>
        <Seg label="Pipeline" value={pipe} onChange={setPipe} options={[["all", "All"], ["ios", "IOS"], ["industrial", "Industrial"]]} />
        <Seg label="Period" value={period} onChange={setPeriod} options={[["week", "By week"], ["month", "By month"]]} />
        {hasAmounts && <Seg label="Show" value={measure} onChange={setMeasure} options={[["count", "Count"], ["amount", "$ offered"]]} />}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="weekly-bars" role="img" aria-label={`${title}, ${measure === "count" ? "count" : "dollars"} per ${period}`} onMouseLeave={() => setHover(null)}>
        {buckets.map((b, i) => {
          const ios = part(b, "ios"), ind = part(b, "industrial"), t = ios + ind;
          const hIos = (ios / max) * (base - top), hInd = (ind / max) * (base - top);
          const x = i * bw + 3, w = bw - 6;
          return (
            <g key={b.start} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} style={{ cursor: "default" }}>
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
              {t === 0 && <rect x={x} y={base - 2} width={w} height={2} rx={1} fill="var(--border)" />}
              {ios > 0 && <rect x={x} y={base - hIos} width={w} height={hIos} rx={2} fill={IOS_COLOR} opacity={hover === i ? 1 : 0.85} />}
              {ind > 0 && <rect x={x} y={base - hIos - hInd} width={w} height={hInd} rx={2} fill={IND_COLOR} opacity={hover === i ? 1 : 0.85} />}
              {t > 0 && <text x={i * bw + bw / 2} y={base - hIos - hInd - 3} textAnchor="middle" fontSize="8.5" fill="var(--muted)">{fmt(t)}</text>}
              <text x={i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize="8" fill="var(--muted)">{b.label}</text>
            </g>
          );
        })}
        <line x1="0" y1={base} x2={W} y2={base} stroke="var(--border)" strokeWidth="1" />
      </svg>

      <p className="hint" style={{ minHeight: "1.4em", margin: "4px 0 0" }}>
        {h ? (
          <>
            <strong>{period === "week" ? `Week of ${h.label}` : h.label}:</strong>{" "}
            {pipe !== "industrial" && <>IOS {h.ios.count} {plural(h.ios.count)}{hasAmounts ? ` (${money(h.ios.amount)})` : ""}</>}
            {pipe === "all" && " · "}
            {pipe !== "ios" && <>Industrial {h.industrial.count} {plural(h.industrial.count)}{hasAmounts ? ` (${money(h.industrial.amount)})` : ""}</>}
          </>
        ) : (
          <>
            {fmt(now)} {measure === "count" ? plural(now) : "offered"} in the last 12 {period === "week" ? "weeks" : "months"}
            {change != null ? ` · ${change >= 0 ? "+" : ""}${Math.round(change * 100)}% vs the 12 before` : before === 0 && now > 0 ? " · none in the 12 before" : ""}
            {pipe === "all" && (
              <span style={{ marginLeft: 8 }}>
                <span style={{ display: "inline-block", width: 9, height: 9, background: IOS_COLOR, borderRadius: 2, marginRight: 3 }} />IOS
                <span style={{ display: "inline-block", width: 9, height: 9, background: IND_COLOR, borderRadius: 2, margin: "0 3px 0 8px" }} />Industrial
              </span>
            )}
          </>
        )}
      </p>
    </section>
  );
}
