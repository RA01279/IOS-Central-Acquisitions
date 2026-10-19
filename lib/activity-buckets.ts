// lib/activity-buckets.ts
//
// Counting dated events (offers, new deals) into calendar weeks (Monday
// start) or calendar months, split by pipeline, for the dashboard charts.
// Pure -- the chart runs it in the browser when a toggle changes.

export type Point = { date: string; amount?: number | null; cls: "ios" | "industrial" };
export type Bucket = {
  start: string; // YYYY-MM-DD, first day of the week / month
  end: string; // last day, inclusive
  label: string;
  ios: { count: number; amount: number };
  industrial: { count: number; amount: number };
};
export type Period = "week" | "month";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
const toIso = (dt: Date) => dt.toISOString().slice(0, 10);
const add = (iso: string, days: number) => { const x = d(iso); x.setUTCDate(x.getUTCDate() + days); return toIso(x); };

/** Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  const dow = (d(iso).getUTCDay() + 6) % 7; // Mon=0
  return add(iso, -dow);
}

/** The last `n` weeks or months ending with the one containing `today`, oldest first. */
export function emptyBuckets(period: Period, today: string, n = 12): Bucket[] {
  const out: Bucket[] = [];
  if (period === "week") {
    const last = weekStart(today);
    for (let i = n - 1; i >= 0; i--) {
      const start = add(last, -7 * i);
      const s = d(start);
      out.push({ start, end: add(start, 6), label: `${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()}`, ios: { count: 0, amount: 0 }, industrial: { count: 0, amount: 0 } });
    }
  } else {
    const t = d(today);
    for (let i = n - 1; i >= 0; i--) {
      const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - i, 1, 12));
      const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1, 12));
      const yr = first.getUTCMonth() === 0 || i === n - 1 ? ` ’${String(first.getUTCFullYear()).slice(2)}` : "";
      out.push({ start: toIso(first), end: add(toIso(next), -1), label: `${MONTHS[first.getUTCMonth()]}${yr}`, ios: { count: 0, amount: 0 }, industrial: { count: 0, amount: 0 } });
    }
  }
  return out;
}

/** Points into buckets; points outside the window are ignored. */
export function bucketize(points: Point[], period: Period, today: string, n = 12): Bucket[] {
  const buckets = emptyBuckets(period, today, n);
  for (const p of points) {
    if (!p.date) continue;
    const day = p.date.slice(0, 10);
    const b = buckets.find((x) => day >= x.start && day <= x.end);
    if (!b) continue;
    b[p.cls].count++;
    b[p.cls].amount += Number(p.amount) || 0;
  }
  return buckets;
}

/** Totals for the same-length window just before this one, for the comparison line. */
export function priorWindow(points: Point[], period: Period, today: string, n = 12) {
  const first = emptyBuckets(period, today, n)[0].start;
  const prevToday = add(first, -1);
  return bucketize(points, period, prevToday, n);
}
