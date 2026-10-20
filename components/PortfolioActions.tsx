"use client";
// components/PortfolioActions.tsx
//
// Archive, restore or delete a whole portfolio package -- the deal page's
// Archive and Delete, applied to every site (/api/deal-portfolios/[id]).
// Archive asks the same questions as one deal; delete takes a two-step
// confirm, since it removes every site's deal and history.

import { useState } from "react";

export default function PortfolioActions({ portfolioId, active, archived, closed }: { portfolioId: string; active: number; archived: number; closed: number }) {
  const [mode, setMode] = useState<null | "archive" | "delete">(null);
  const [reason, setReason] = useState("");
  const [disposition, setDisposition] = useState("");
  const [pursuitScore, setPursuitScore] = useState("");
  const [followUpOn, setFollowUpOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function call(init: RequestInit, done: (body: any) => void) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deal-portfolios/${portfolioId}`, { ...init, headers: { "Content-Type": "application/json" } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "That didn't work");
      done(body);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }
  const archive = () =>
    call({ method: "POST", body: JSON.stringify({ action: "archive", reason, disposition: disposition || undefined, pursuitScore: pursuitScore || undefined, followUpOn: followUpOn || undefined }) }, (b) => {
      if (b.failed?.length || b.skipped?.length) { setNote(`Archived ${b.archived}. ${[...b.skipped, ...b.failed].join(" · ")}`); setBusy(false); setMode(null); }
      else window.location.reload();
    });
  const restore = () =>
    call({ method: "POST", body: JSON.stringify({ action: "restore" }) }, (b) => {
      if (b.failed?.length) { setNote(`Restored ${b.restored}. ${b.failed.join(" · ")}`); setBusy(false); }
      else window.location.reload();
    });
  // Hard navigation, so the board re-renders without the deleted deals.
  const remove = () => call({ method: "DELETE" }, () => window.location.assign("/deals"));

  const sites = active + archived + closed;
  return (
    <section className="panel">
      <h2>Portfolio actions</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        {active} active · {archived} archived{closed ? ` · ${closed} closed (closed sites are never archived or deleted)` : ""}
      </p>
      <div className="stage-actions">
        {active > 0 && mode !== "archive" && <button type="button" className="secondary" disabled={busy} onClick={() => setMode("archive")}>Archive the portfolio ({active} site{active === 1 ? "" : "s"})</button>}
        {archived > 0 && <button type="button" className="secondary" disabled={busy} onClick={restore}>{busy && mode === null ? "Restoring…" : `Restore ${archived} archived site${archived === 1 ? "" : "s"}`}</button>}
      </div>

      {mode === "archive" && (
        <div className="inline-add-form" style={{ width: "100%" }}>
          <div className="grid-2">
            <label>
              Reason
              <input placeholder="e.g. seller pulled the package, we passed on the portfolio" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label>
              Why it&apos;s parked
              <select value={disposition} onChange={(e) => setDisposition(e.target.value)}>
                <option value="">—</option>
                <option value="not_selling">Not selling (yet)</option>
                <option value="lost">Lost to another buyer</option>
                <option value="passed">We passed</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Target score
              <select value={pursuitScore} onChange={(e) => setPursuitScore(e.target.value)}>
                <option value="">— unscored —</option>
                <option value="5">5 — Must have (white whale)</option>
                <option value="4">4 — Want it</option>
                <option value="3">3 — Would take it</option>
                <option value="2">2 — Marginal</option>
                <option value="1">1 — Only at a steal</option>
                <option value="0">0 — Never a target</option>
              </select>
            </label>
            {pursuitScore !== "0" && (
              <label>
                Follow up on
                <input type="date" value={followUpOn} onChange={(e) => setFollowUpOn(e.target.value)} />
              </label>
            )}
          </div>
          <p className="hint">Every active site is archived with this reason, the portfolio&apos;s name added. Each can be restored on its own deal page, or all together here.</p>
          <div className="stage-actions" style={{ marginBottom: 0 }}>
            <button type="button" onClick={archive} disabled={busy || !reason.trim()}>{busy ? "Archiving…" : `Archive ${active} site${active === 1 ? "" : "s"}`}</button>
            <button type="button" className="secondary" onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="danger-zone">
        {mode !== "delete" ? (
          <button type="button" className="danger-link" disabled={busy} onClick={() => setMode("delete")}>
            Delete this portfolio and its {sites} deal{sites === 1 ? "" : "s"} (duplicate / entered in error)
          </button>
        ) : (
          <div className="stage-actions" style={{ marginBottom: 0 }}>
            <span className="error">Permanently delete the portfolio and all {sites} of its deals, with their history and documents? This cannot be undone.</span>
            <button type="button" className="danger-btn" onClick={remove} disabled={busy}>{busy ? "Deleting…" : "Delete forever"}</button>
            <button type="button" className="secondary" onClick={() => setMode(null)}>Cancel</button>
          </div>
        )}
      </div>
      {note && <p className="warning">{note}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
