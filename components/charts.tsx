// components/charts.tsx
//
// Small, dependency-free charts for report pages. Plain HTML/CSS (no canvas,
// no client JS) so they render on the server, print cleanly to PDF and stay
// legible at phone width. Styles live in app/hopper.css under "Charts".
//
// Colors: pass one of SERIES (validated together for colour-blind separation
// on white) for identity, e.g. IOS vs Industrial. Hover text is the native
// title tooltip; every chart also prints its numbers as visible labels, so
// nothing is read from colour alone.

import Link from "next/link";
import type { ReactNode } from "react";

/** Categorical slots, fixed order. 1 = brand blue (IOS), 2 = orange (Industrial), 3 = aqua. */
export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"] as const;
/** A light step of the brand blue, for "the rest" next to a series-1 part. */
export const SERIES_SOFT = "var(--series-1-soft)";

export type Segment = { value: number; color: string; title?: string };

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="viz-legend">
      {items.map((i) => (
        <span key={i.label} className="viz-legend-item">
          <span className="viz-swatch" style={{ background: i.color }} aria-hidden />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Horizontal bars, one row per item, optionally stacked. Rows share one scale
 * (the largest total, or `max`), so lengths compare across rows.
 */
export function BarRows({
  rows,
  max,
  labelWidth = 130,
}: {
  rows: { key: string; label: ReactNode; href?: string; segments: Segment[]; value: ReactNode; title?: string }[];
  max?: number;
  labelWidth?: number;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.segments.reduce((t, s) => t + s.value, 0)));
  return (
    <div className="viz-rows" style={{ gridTemplateColumns: `minmax(0, ${labelWidth}px) minmax(60px, 1fr) auto` }}>
      {rows.map((r) => {
        const total = r.segments.reduce((t, s) => t + s.value, 0);
        return (
          <div key={r.key} className="viz-row" title={r.title}>
            <span className="viz-row-label">{r.href ? <Link href={r.href}>{r.label}</Link> : r.label}</span>
            <span className="viz-track">
              {total > 0 ? (
                <span className="viz-stack" style={{ width: `${(total / top) * 100}%` }}>
                  {r.segments.filter((s) => s.value > 0).map((s, i) => (
                    <span key={i} className="viz-seg" style={{ flexGrow: s.value, background: s.color }} title={s.title} />
                  ))}
                </span>
              ) : null}
            </span>
            <span className="viz-row-value">{r.value}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Vertical columns (e.g. one per day), optionally stacked, with the total above each. */
export function Columns({
  cols,
  height = 130,
}: {
  cols: { key: string; label: ReactNode; sub?: ReactNode; segments: Segment[]; title?: string; muted?: boolean }[];
  height?: number;
}) {
  const top = Math.max(1, ...cols.map((c) => c.segments.reduce((t, s) => t + s.value, 0)));
  return (
    <div className="viz-cols" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
      {cols.map((c) => {
        const total = c.segments.reduce((t, s) => t + s.value, 0);
        return (
          <div key={c.key} className={c.muted ? "viz-col muted" : "viz-col"} title={c.title}>
            <div className="viz-col-plot" style={{ height }}>
              <span className="viz-col-total">{total || ""}</span>
              <span className="viz-col-stack" style={{ height: `${(total / top) * 100}%` }}>
                {c.segments.filter((s) => s.value > 0).map((s, i) => (
                  <span key={i} className="viz-seg" style={{ flexGrow: s.value, background: s.color }} title={s.title} />
                ))}
              </span>
            </div>
            <span className="viz-col-label">{c.label}</span>
            {c.sub ? <span className="viz-col-sub">{c.sub}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/** A headline number tile; a link when `href` is set. */
export function Stat({ label, value, sub, href, bad }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; bad?: boolean }) {
  const body = (
    <>
      <span className={bad ? "stat-value stat-bad" : "stat-value"}>{value}</span>
      <span className="stat-label">{label}</span>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </>
  );
  return href ? <Link href={href} className="stat-tile">{body}</Link> : <div className="stat-tile">{body}</div>;
}
