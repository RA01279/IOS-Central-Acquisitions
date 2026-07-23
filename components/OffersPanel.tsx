"use client";
// components/OffersPanel.tsx
//
// Negotiation history on an acquisition: every offer with date, price, and
// land-basis PSF (price / lot SF -- how IOS deals are actually priced).
// Replaces the tracker's Last Offer Date / Last Offer Price / Times Offered
// columns with the full history.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Offer = {
  id: string;
  offered_at: string | null;
  price: number | null;
  notes: string | null;
  created_by: string;
};

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
          price: form.get("price") ? Number(form.get("price")) : undefined,
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
                {o.notes && <div className="muted">{o.notes}</div>}
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
