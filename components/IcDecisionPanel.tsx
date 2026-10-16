"use client";
// components/IcDecisionPanel.tsx
//
// The IC outcome on record: approved / with conditions / declined /
// deferred, the approved price and conditions. Newest first; the top one
// stands.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { moneyPreview } from "@/lib/money";

type Decision = {
  id: string;
  decided_on: string;
  outcome: string;
  approved_price: number | null;
  conditions: string | null;
  notes: string | null;
  created_by: string;
};

const LABELS: Record<string, string> = {
  approved: "Approved",
  conditional: "Approved with conditions",
  declined: "Declined",
  deferred: "Deferred",
};
const TONE: Record<string, string> = { approved: "#1E7A46", conditional: "#B26A00", declined: "#B3261E", deferred: "#6B7280" };
const usd = (v: number | null) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);

export default function IcDecisionPanel({
  dealId,
  decisions,
  icOn,
  requiredForPsa,
}: {
  dealId: string;
  decisions: Decision[];
  icOn: string | null;
  requiredForPsa: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("approved");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const standing = decisions[0] ?? null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/deals/${dealId}/ic-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decidedOn: form.get("decidedOn"),
          outcome,
          approvedPrice: price || null,
          conditions: form.get("conditions"),
          notes: form.get("notes"),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setOpen(false);
      setPrice("");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(d: Decision) {
    if (!confirm(`Remove the ${LABELS[d.outcome]?.toLowerCase()} decision from ${d.decided_on}?`)) return;
    const res = await fetch(`/api/deals/${dealId}/ic-decision`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decisionId: d.id }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Remove failed");
    router.refresh();
  }

  return (
    <section className="panel">
      <h2>IC decision</h2>
      {standing ? (
        <p style={{ marginTop: 0 }}>
          <strong style={{ color: TONE[standing.outcome] }}>{LABELS[standing.outcome] ?? standing.outcome}</strong>
          {" "}on {standing.decided_on}
          {standing.approved_price ? <> at <strong>{usd(standing.approved_price)}</strong></> : null}
          {standing.conditions ? <><br /><span className="muted">Conditions: {standing.conditions}</span></> : null}
        </p>
      ) : (
        <p className="hint" style={{ marginTop: 0 }}>
          No IC decision recorded.{requiredForPsa ? " Moving to PSA needs an approval on record." : ""}
        </p>
      )}

      {!open ? (
        <button type="button" onClick={() => setOpen(true)}>Record IC decision</button>
      ) : (
        <form onSubmit={submit} className="inline-add-form">
          <div className="grid-2">
            <label>
              IC date
              <input name="decidedOn" type="date" defaultValue={icOn ?? new Date().toISOString().slice(0, 10)} required />
            </label>
            <label>
              Outcome
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {Object.entries(LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            {(outcome === "approved" || outcome === "conditional") && (
              <label>
                Approved up to ($)
                <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 4.2M" />
                <span className="hint">{moneyPreview(price)}</span>
              </label>
            )}
          </div>
          {outcome === "conditional" && (
            <label>
              Conditions
              <textarea name="conditions" rows={3} placeholder="e.g. Phase I clean; zoning letter confirming outdoor storage by right" />
            </label>
          )}
          <label>
            Notes
            <textarea name="notes" rows={2} />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="stage-actions" style={{ marginBottom: 0 }}>
            <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save decision"}</button>
            <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}

      {decisions.length > 0 && (
        <table className="summary-table" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>Date</th><th>Outcome</th><th>Approved price</th><th>Conditions / notes</th><th>By</th><th></th></tr>
          </thead>
          <tbody>
            {decisions.map((d) => (
              <tr key={d.id}>
                <td>{d.decided_on}</td>
                <td style={{ color: TONE[d.outcome] }}>{LABELS[d.outcome] ?? d.outcome}</td>
                <td>{usd(d.approved_price)}</td>
                <td>{[d.conditions, d.notes].filter(Boolean).join(" — ") || "—"}</td>
                <td className="muted">{d.created_by.split("@")[0]}</td>
                <td><button type="button" className="secondary" title="Remove" onClick={() => void remove(d)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!open && error && <p className="error">{error}</p>}
    </section>
  );
}
