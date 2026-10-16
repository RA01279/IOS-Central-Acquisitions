"use client";
// components/OffersPanel.tsx
//
// Negotiation history on an acquisition: every offer with date, price, and
// land-basis PSF (price / lot SF -- how IOS deals are actually priced).
// Replaces the tracker's Last Offer Date / Last Offer Price / Times Offered
// columns with the full history.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OFFER_STATUSES, OFFER_STATUS_LABELS, bidAskGap } from "@/lib/offer-status";

type Offer = {
  id: string;
  offered_at: string | null;
  price: number | null;
  notes: string | null;
  created_by: string;
  status?: string | null;
  counter_price?: number | null;
  responded_on?: string | null;
};

const STATUS_TONE: Record<string, string> = { accepted: "#1E7A46", countered: "#B26A00", rejected: "#B3261E", withdrawn: "#6B7280", expired: "#6B7280", sent: "#2E6DA4" };

function fmtUsd(v: number | null) {
  return v === null || v === undefined ? "—" : `$${Math.round(v).toLocaleString()}`;
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

  const sorted = [...offers].sort((a, b) => (b.offered_at ?? "").localeCompare(a.offered_at ?? ""));

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

  // Where the negotiation stands: rounds, and the gap on the latest counter.
  const latestCounter = sorted.find((o) => o.counter_price);
  const gap = latestCounter ? bidAskGap(latestCounter.price, latestCounter.counter_price) : null;

  async function handleRemove(offerId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/offers`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>
        Offers
        {sorted.length > 0 && <span className="count" style={{ marginLeft: 8 }}>{sorted.length}</span>}
      </h2>

      {sorted.length > 0 && (
        <p className="hint" style={{ marginTop: 0 }}>
          {sorted.length} round{sorted.length === 1 ? "" : "s"} · latest {OFFER_STATUS_LABELS[sorted[0].status ?? "sent"]?.toLowerCase()}
          {gap && latestCounter
            ? ` · seller at ${fmtUsd(latestCounter.counter_price ?? null)} vs our ${fmtUsd(latestCounter.price)}: ${fmtUsd(gap.dollars)} apart (${(gap.pct * 100).toFixed(1)}%)`
            : ""}
        </p>
      )}
      {sorted.length === 0 ? (
        <p className="muted">No offers yet. Logging one moves the deal to Offered.</p>
      ) : (
        <ul className="doc-list">
          {sorted.map((o, i) => {
            const psf = landPsf(o.price);
            return (
              <li key={o.id}>
                <strong>{fmtUsd(o.price)}</strong>
                {psf !== null && <span className="muted"> · ${psf.toFixed(2)}/SF land</span>}
                {o.offered_at && <span className="muted"> · {o.offered_at}</span>}
                <span className="muted"> · {o.created_by}</span>
                {i === 0 && <span className="doc-type" style={{ marginLeft: 6 }}>LATEST</span>}
                <span className="doc-type" style={{ marginLeft: 6, color: STATUS_TONE[o.status ?? "sent"] }}>
                  {(OFFER_STATUS_LABELS[o.status ?? "sent"] ?? o.status ?? "Sent").toUpperCase()}
                </span>
                {o.counter_price ? (
                  <span className="muted">
                    {" "}· counter {fmtUsd(o.counter_price)}
                    {(() => { const g = bidAskGap(o.price, o.counter_price); return g ? ` (+${(g.pct * 100).toFixed(1)}%)` : ""; })()}
                  </span>
                ) : null}
                {o.responded_on && <span className="muted"> · answered {o.responded_on}</span>}
                {o.notes && <div className="muted">{o.notes}</div>}
                {responding === o.id ? (
                  <form onSubmit={(e) => handleRespond(e, o.id)} className="stage-actions" style={{ margin: "6px 0 0" }}>
                    <select name="status" defaultValue={o.status ?? "sent"} aria-label="Seller response">
                      {OFFER_STATUSES.map((st) => <option key={st} value={st}>{OFFER_STATUS_LABELS[st]}</option>)}
                    </select>
                    <input name="counterPrice" placeholder="Counter, e.g. 4.6M" defaultValue={o.counter_price ? String(Math.round(o.counter_price)) : ""} style={{ width: 140 }} />
                    <input name="respondedOn" type="date" defaultValue={o.responded_on ?? new Date().toISOString().slice(0, 10)} />
                    <button type="submit" disabled={busy}>Save</button>
                    <button type="button" className="secondary" onClick={() => setResponding(null)}>Cancel</button>
                  </form>
                ) : (
                  <button type="button" className="link-caps" style={{ marginLeft: 8 }} onClick={() => setResponding(o.id)} disabled={busy}>
                    Seller response
                  </button>
                )}
                <button
                  type="button"
                  className="link-remove"
                  onClick={() => handleRemove(o.id)}
                  disabled={busy}
                  title="Remove offer"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!adding && error && <p className="error">{error}</p>}
      {!adding ? (
        <div className="stage-actions" style={{ marginTop: 12, marginBottom: 0 }}>
          <button onClick={() => setAdding(true)}>+ Log offer</button>
        </div>
      ) : (
        <form onSubmit={handleAdd} className="inline-add-form">
          <div className="grid-2">
            <label>
              Offer price ($)
              <input name="price" type="number" step="1000" required autoFocus />
            </label>
            <label>
              Offer date
              <input name="offeredAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
          </div>
          <label>
            Notes
            <input name="notes" placeholder="e.g. countered at $4.6M, seller wants 30-day close" />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="stage-actions" style={{ marginBottom: 0 }}>
            <button type="submit" disabled={busy}>
              {busy ? "Logging…" : "Log offer"}
            </button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
