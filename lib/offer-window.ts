// lib/offer-window.ts
//
// The date window the offer log (app/offers) and its CSV (app/api/offers/csv)
// show: a preset (last 7 days, month to date, year to date) or a custom
// from / to picked by date. One function so the page and the download always
// agree. Also the chart buckets for a window: days for up to two weeks, weeks
// for up to ~four months, months beyond.

import { isRangeKey, rangeStart, RANGE_LABELS, type RangeKey } from "./summary";

export type OfferWindow = { range: RangeKey | "custom"; start: string; end: string; label: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const valid = (v: unknown): v is string => typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

/**
 * ?from=&to= wins when `from` is a real date (`to` defaults to today and the
 * two are swapped if entered backwards); otherwise ?range=, defaulting to YTD.
 */
export function offerWindow(params: { range?: string | null; from?: string | null; to?: string | null }, today: string): OfferWindow {
  if (valid(params.from)) {
    let start = params.from, end = valid(params.to) ? params.to : today;
    if (start > end) [start, end] = [end, start];
    return { range: "custom", start, end, label: `${fmt(start)} – ${fmt(end)}` };
  }
  const range: RangeKey = isRangeKey(params.range) ? params.range : "ytd";
  return { range, start: rangeStart(range, today), end: today, label: RANGE_LABELS[range] };
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const label = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

export type Bucket = { key: string; from: string; to: string; label: string; sub?: string };

/** Chart columns covering the window: by day, week or month depending on its length. */
export function windowBuckets(w: { start: string; end: string }): { unit: "day" | "week" | "month"; buckets: Bucket[] } {
  const span = daysBetween(w.start, w.end) + 1;
  const buckets: Bucket[] = [];
  if (span <= 14) {
    for (let d = w.start; d <= w.end; d = addDays(d, 1)) buckets.push({ key: d, from: d, to: d, label: label(d, { weekday: "short" }), sub: label(d, { month: "short", day: "numeric" }) });
    return { unit: "day", buckets };
  }
  if (span <= 120) {
    for (let d = w.start; d <= w.end; d = addDays(d, 7)) {
      const to = addDays(d, 6) < w.end ? addDays(d, 6) : w.end;
      buckets.push({ key: d, from: d, to, label: label(d, { month: "short", day: "numeric" }) });
    }
    return { unit: "week", buckets };
  }
  const multiYear = w.start.slice(0, 4) !== w.end.slice(0, 4);
  for (let m = `${w.start.slice(0, 7)}-01`; m <= w.end; ) {
    const next = new Date(`${m}T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const nextIso = next.toISOString().slice(0, 10);
    const from = m < w.start ? w.start : m;
    const to = addDays(nextIso, -1) < w.end ? addDays(nextIso, -1) : w.end;
    buckets.push({ key: m, from, to, label: label(m, multiYear ? { month: "short", year: "2-digit" } : { month: "short" }) });
    m = nextIso;
  }
  return { unit: "month", buckets };
}
