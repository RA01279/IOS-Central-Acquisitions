"use client";

// Build the IC executive summary from the acquisition model.
//
// The workbook is read here, in the browser: only the extracted figures are
// sent to Hopper, never the file. The analyst sees the headline numbers and
// every model check before downloading, because a deck that disagrees with
// the model is worse than no deck.

import { useEffect, useState } from "react";
import { openWorkbook } from "@/lib/ic-deck/xlsx-lite";
import { extractModel, type ModelSummary } from "@/lib/ic-deck/model";

const pct = (v: number | null, d = 2) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const usd = (v: number | null) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);

export default function IcDeckBuilder({ dealId, fileNameStem }: { dealId: string; fileNameStem?: string | null }) {
  const [model, setModel] = useState<ModelSummary | null>(null);
  const [reading, setReading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<{ id: string; status: string; error?: string | null; finished_at?: string | null } | null>(null);
  const [useDraft, setUseDraft] = useState(true);
  const [starting, setStarting] = useState(false);

  // Latest IC narrative run for this deal; poll while it is queued or running.
  useEffect(() => {
    let live = true;
    async function refresh() {
      try {
        const r = await fetch(`/api/agents?latest=ic-narrative&deal=${encodeURIComponent(dealId)}`, { cache: "no-store" });
        if (r.ok && live) setRun((await r.json()).run);
      } catch { /* agents unavailable: the deck still builds without a draft */ }
    }
    void refresh();
    const timer = setInterval(() => { if (run && ["queued", "processing"].includes(run.status)) void refresh(); }, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [dealId, run?.status]);

  async function startNarrative() {
    if (!model) return;
    setStarting(true);
    setError(null);
    // Public property facts only: no price, returns or rent go to a web-searching agent.
    const p = model.property;
    const text = [
      `Subject: ${p.address ?? ""}, ${p.cityState ?? ""}.`,
      p.acres ? `Site: ${p.acres} acres.` : "",
      p.buildingSf ? `Building: ${Math.round(p.buildingSf).toLocaleString("en-US")} SF.` : "",
      model.rentRoll.rows.length ? `Tenant(s): ${model.rentRoll.rows.map((r) => r.tenant).join("; ")}.` : "Vacant at closing.",
    ].filter(Boolean).join(" ");
    try {
      const r = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent: "ic-narrative", dealId, text }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not start the agent.");
      setRun({ id: data.id, status: "queued" });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  }

  async function choose(file: File | undefined) {
    setModel(null);
    setError(null);
    if (!file) return;
    setReading(true);
    try {
      const book = openWorkbook(await file.arrayBuffer());
      setModel(extractModel(book, file.name));
    } catch (e: any) {
      setError(e?.message ?? "Could not read that workbook.");
    } finally {
      setReading(false);
    }
  }

  async function build() {
    if (!model) return;
    setBuilding(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/ic-deck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, narrativeRunId: useDraft && run?.status === "completed" ? run.id : null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Deck build failed (${res.status}).`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileNameStem || "deal"}_IC_Exec_Summary_DRAFT.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBuilding(false);
    }
  }

  const price = model?.capitalization.find((c) => /price/i.test(c.label))?.amount ?? null;

  return (
    <section className="panel" aria-labelledby="ic-deck-builder-heading">
      <h2 id="ic-deck-builder-heading">IC Deck — Executive Summary</h2>
      <p className="hint">
        Choose the current UW model (.xlsx). Returns, capitalization, rent roll, cash flow and sensitivities are copied from
        the model exactly as Excel last calculated them; comps, owned assets, pursuit terms and maps come from Hopper. Tenant,
        market canvas, zoning and photos are left as marked open items. The workbook stays on this computer.
      </p>
      <label>
        Acquisition model
        <input type="file" accept=".xlsx,.xlsm" disabled={reading || building} onChange={(e) => choose(e.target.files?.[0])} />
      </label>
      {reading && <p role="status">Reading the model…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {model && (
        <div aria-live="polite">
          <p>
            <strong>{model.property.address ?? "Unknown property"}</strong>
            {model.source.modelDate ? ` · model as of ${model.source.modelDate}` : ""}
          </p>
          <table className="summary-table">
            <tbody>
              <tr><th scope="row">Price / all-in</th><td>{usd(price)} / {usd(model.totalCost.amount)}</td></tr>
              <tr><th scope="row">GLIRR · GUIRR · LP IRR</th><td>{pct(model.returns.levered.irr)} · {pct(model.returns.unlevered.irr)} · {pct(model.returns.lp.irr)}</td></tr>
              <tr><th scope="row">Equity multiple</th><td>{model.returns.levered.multiple?.toFixed(2) ?? "—"}x</td></tr>
              <tr><th scope="row">Going-in · exit cap</th><td>{pct(model.yields.goingIn, 2)} · {pct(model.yields.exitCap, 2)}</td></tr>
              <tr><th scope="row">Hold · WALT</th><td>{model.returns.holdYears ?? "—"} yrs · {model.rentRoll.waltYears?.toFixed(2) ?? "—"} yrs</td></tr>
            </tbody>
          </table>
          {model.warnings.length > 0 ? (
            <div className="warning" role="note">
              <strong>Model checks ({model.warnings.length}) — fix in the model or confirm before circulating:</strong>
              <ul>{model.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          ) : (
            <p className="hint">Model checks passed.</p>
          )}
          <div className="panel-inset">
            <strong>Analyst sections (location, zoning, tenant, market)</strong>
            {!run && <p className="hint">No agent draft yet. The agent researches public sources on your connected computer and cites each point; it receives the address, size and tenant names only.</p>}
            {run && ["queued", "processing"].includes(run.status) && <p role="status">Agent is researching ({run.status})… this can take several minutes.</p>}
            {run?.status === "failed" && <p className="error">Last agent run failed: {run.error ?? "unknown error"}</p>}
            {run?.status === "completed" && (
              <label>
                <input type="checkbox" checked={useDraft} onChange={(e) => setUseDraft(e.target.checked)} /> Include the agent draft from {run.finished_at?.slice(0, 10) ?? "the last run"} (marked “Agent draft — verify”, sources in notes)
              </label>
            )}
            {!(run && ["queued", "processing"].includes(run.status)) && (
              <button type="button" className="secondary" onClick={startNarrative} disabled={starting}>
                {starting ? "Starting…" : run ? "Run the agent again" : "Draft with agent"}
              </button>
            )}
          </div>
          <button type="button" onClick={build} disabled={building}>
            {building ? "Building deck…" : "Download IC deck (.pptx)"}
          </button>
        </div>
      )}
    </section>
  );
}
