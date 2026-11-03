"use client";
// components/OffersPanel.tsx
//
// Negotiation history on an acquisition: every offer with date, price, and
// land-basis PSF (price / lot SF -- how IOS deals are actually priced).
// Replaces the tracker's Last Offer Date / Last Offer Price / Times Offered
// columns with the full history.

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { OFFER_STATUSES, OFFER_STATUS_LABELS, bidAskGap } from "@/lib/offer-status";
import { Badge, type BadgeTone } from "@/components/ui";

type Offer = {
  id: string;
  offered_at: string | null;
  price: number | null;
  notes: string | null;
  created_by: string;
  created_at?: string | null;
  status?: string | null;
  counter_price?: number | null;
  responded_on?: string | null;
};

const STATUS_TONE: Record<string, BadgeTone> = {
  sent: "brand",
  countered: "warning",
  accepted: "success",
  rejected: "danger",
  withdrawn: "neutral",
  expired: "neutral",
};

function fmtUsd(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `$${Math.round(v).toLocaleString("en-US")}`;
}
/** "Aug 25, 2026" from YYYY-MM-DD, without timezone drift. */
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
/** Today in the browser's zone -- toISOString() is UTC and reads as tomorrow every evening. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function gapLabel(price: number | null, counter: number | null | undefined) {
  const g = bidAskGap(price, counter);
  return g ? `${g.dollars >= 0 ? "+" : "−"}${fmtUsd(Math.abs(g.dollars))} (${g.pct >= 0 ? "+" : "−"}${Math.abs(g.pct * 100).toFixed(1)}%)` : null;
}

export default function OffersPanel({
  dealId,
  offers,
  lotSf,
}: {
  dealId: string;
  offers: Offer[];
  lotSf: number | null;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responding, setResponding] = useState<string | null>(null);

  // Newest first; two offers on one day fall back to when they were logged.
  const sorted = [...offers].sort(
    (a, b) => (b.offered_at ?? "").localeCompare(a.offered_at ?? "") || (b.created_at ?? "").localeCompare(a.created_at ?? "")
  );

  function landPsf(price: number | null) {
    if (!price || !lotSf) return null;
    return price / lotSf;
  }

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/deals/${dealId}/offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offeredAt: form.get("offeredAt") || undefined,
          price: form.get("price") || undefined,
          notes: form.get("notes") || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to log offer");
      setAdding(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRespond(e: React.FormEvent<HTMLFormElement>, offerId: string) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/deals/${dealId}/offers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId,
          status: form.get("status"),
          counterPrice: form.get("counterPrice") || null,
          respondedOn: form.get("respondedOn") || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setResponding(null);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(o: Offer) {
    if (!window.confirm(`Remove the ${fmtUsd(o.price)} offer from ${fmtDate(o.offered_at)}? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/offers`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId: o.id }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't remove the offer");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Where the negotiation stands: rounds, and the gap on the latest counter.
  const latestCounter = sorted.find((o) => o.counter_price);
  const gap = latestCounter ? bidAskGap(latestCounter.price, latestCounter.counter_price) : null;
  const latest = sorted[0];

  return (
    <section className="panel">
      <div className="fin-head">
        <h2>
          Offers
          {sorted.length > 0 && <span className="count" style={{ marginLeft: 8 }}>{sorted.length}</span>}
        </h2>
        {!adding && (
          <button type="button" className="fin-head-action" onClick={() => setAdding(true)}>
            + Log offer
          </button>
        )}
      </div>

      {latest && (
        <div className="fin-stats fin-stats-tight">
          <Stat label="Latest offer" value={fmtUsd(latest.price)} sub={fmtDate(latest.offered_at)} />
          <Stat label="Status" value={OFFER_STATUS_LABELS[latest.status ?? "sent"] ?? "Sent"} />
          {latestCounter && <Stat label="Seller at" value={fmtUsd(latestCounter.counter_price)} />}
          {gap && <Stat label="Gap" value={fmtUsd(gap.dollars)} sub={`${(gap.pct * 100).toFixed(1)}% over our offer`} />}
        </div>
      )}

      {sorted.length === 0 ? (
        !adding && <p className="muted">No offers yet. Logging one moves the deal to Offered.</p>
      ) : (
        <div className="table-scroll">
          <table className="summary-table fin-table fin-offers">
            <thead>
              <tr>
                <th>Date</th>
                <th>Offer</th>
                {lotSf ? <th>$/SF land</th> : null}
                <th className="fin-text">Status</th>
                <th>Counter</th>
                <th>Responded</th>
                <th className="fin-text">By</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((o) => {
                const psf = landPsf(o.price);
                const st = o.status ?? "sent";
                const g = o.counter_price ? gapLabel(o.price, o.counter_price) : null;
                return (
                  <Fragment key={o.id}>
                    <tr className={o.notes || responding === o.id ? "fin-has-sub" : undefined}>
                      <td className="fin-text">{fmtDate(o.offered_at)}</td>
                      <td><strong>{fmtUsd(o.price)}</strong></td>
                      {lotSf ? <td>{psf !== null ? `$${psf.toFixed(2)}` : "—"}</td> : null}
                      <td className="fin-text">
                        <Badge tone={STATUS_TONE[st] ?? "neutral"}>{OFFER_STATUS_LABELS[st] ?? st}</Badge>
                      </td>
                      <td>
                        {o.counter_price ? (
                          <>
                            {fmtUsd(o.counter_price)}
                            {g && <span className="fin-sub-num">{g}</span>}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{o.responded_on ? fmtDate(o.responded_on) : "—"}</td>
                      <td className="fin-text muted">{o.created_by?.split("@")[0]}</td>
                      <td className="fin-actions">
                        {responding !== o.id && (
                          <button type="button" className="link-caps" onClick={() => setResponding(o.id)} disabled={busy}>
                            Seller response
                          </button>
                        )}
                        <button type="button" className="link-remove" onClick={() => handleRemove(o)} disabled={busy} title="Remove offer" aria-label="Remove offer">
                          ×
                        </button>
                      </td>
                    </tr>
                    {(o.notes || responding === o.id) && (
                      <tr className="fin-subrow">
                        <td colSpan={lotSf ? 8 : 7}>
                          {o.notes && <div className="muted">{o.notes}</div>}
                          {responding === o.id && (
                            <form onSubmit={(e) => handleRespond(e, o.id)} className="fin-inline-form">
                              <label>
                                Seller response
                                <select name="status" defaultValue={st === "sent" ? "countered" : st}>
                                  {OFFER_STATUSES.map((s) => <option key={s} value={s}>{OFFER_STATUS_LABELS[s]}</option>)}
                                </select>
                              </label>
                              <label>
                                Counter
                                <input name="counterPrice" placeholder="e.g. 4.6M" defaultValue={o.counter_price ? String(Math.round(o.counter_price)) : ""} autoFocus />
                              </label>
                              <label>
                                Answered on
                                <input name="respondedOn" type="date" defaultValue={o.responded_on ?? today()} />
                              </label>
                              <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
                              <button type="button" className="secondary" onClick={() => setResponding(null)}>Cancel</button>
                            </form>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!adding && error && <p className="error">{error}</p>}
      {adding && (
        <form onSubmit={handleAdd} className="inline-add-form">
          <div className="grid-2">
            <label>
              Offer price
              {/* Text, not number: the API reads "4.75M" and "4,750,000" alike,
                  and a number input with a step rejected odd-thousand prices. */}
              <input name="price" inputMode="decimal" placeholder="e.g. 4.75M" required autoFocus />
            </label>
            <label>
              Offer date
              <input name="offeredAt" type="date" defaultValue={today()} />
            </label>
          </div>
          <label>
            Notes
            <input name="notes" placeholder="e.g. seller wants a 30-day close" />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="stage-actions" style={{ marginBottom: 0 }}>
            <button type="submit" disabled={busy}>
              {busy ? "Logging…" : "Log offer"}
            </button>
            <button type="button" className="secondary" onClick={() => { setAdding(false); setError(null); }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}
