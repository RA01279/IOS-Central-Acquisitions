// lib/uw/irr.ts
//
// IRR for annual cash flows, mirroring the workbook's
//   =IFERROR(IRR(cf), IFERROR(IRR(cf,-0.15), IFERROR(IRR(cf,-0.3), "n/m")))
// Newton's method from each guess in that order; if none converges, a
// bisection over a sign change in NPV. Returns null for "n/m" -- never NaN.

const GUESSES = [0.1, -0.15, -0.3] as const;
const MAX_NEWTON_ITER = 100;
const RATE_TOL = 1e-12;
// Rates at or below -100% make (1+r)^t undefined or meaningless.
const MIN_RATE = -0.999999;

export function npv(rate: number, cashFlows: readonly number[]): number {
  let total = 0;
  for (let t = 0; t < cashFlows.length; t++) total += cashFlows[t] / (1 + rate) ** t;
  return total;
}

function dNpv(rate: number, cashFlows: readonly number[]): number {
  let total = 0;
  for (let t = 1; t < cashFlows.length; t++) total -= (t * cashFlows[t]) / (1 + rate) ** (t + 1);
  return total;
}

function newton(cashFlows: readonly number[], guess: number): number | null {
  let r = guess;
  for (let i = 0; i < MAX_NEWTON_ITER; i++) {
    const f = npv(r, cashFlows);
    const d = dNpv(r, cashFlows);
    if (!Number.isFinite(f) || !Number.isFinite(d) || d === 0) return null;
    const next = r - f / d;
    if (!Number.isFinite(next) || next <= MIN_RATE) return null;
    if (Math.abs(next - r) < RATE_TOL) return next;
    r = next;
  }
  return null;
}

function bisection(cashFlows: readonly number[]): number | null {
  // Scan for the sign change nearest the usual range first, then widen.
  const grid: number[] = [];
  for (let r = -0.99; r <= 10; r += 0.01) grid.push(r);
  let bracket: [number, number] | null = null;
  let fPrev = npv(grid[0], cashFlows);
  for (let i = 1; i < grid.length; i++) {
    const f = npv(grid[i], cashFlows);
    if (Number.isFinite(f) && Number.isFinite(fPrev) && Math.sign(f) !== Math.sign(fPrev)) {
      bracket = [grid[i - 1], grid[i]];
      break;
    }
    fPrev = f;
  }
  if (bracket === null) return null;
  let [lo, hi] = bracket;
  let fLo = npv(lo, cashFlows);
  for (let i = 0; i < 200; i++) {
    const mid: number = (lo + hi) / 2;
    const fMid = npv(mid, cashFlows);
    if (fMid === 0 || hi - lo < RATE_TOL) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/** IRR of cash flows at t = 0, 1, 2... Null when it doesn't exist or can't be found ("n/m"). */
export function irr(cashFlows: readonly number[]): number | null {
  // Excel's IRR needs at least one positive and one negative value.
  if (!cashFlows.some((v) => v > 0) || !cashFlows.some((v) => v < 0)) return null;
  for (const guess of GUESSES) {
    const r = newton(cashFlows, guess);
    if (r !== null && Number.isFinite(r)) return r;
  }
  const r = bisection(cashFlows);
  return r !== null && Number.isFinite(r) ? r : null;
}
