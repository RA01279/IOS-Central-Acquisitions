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
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { validateReference } from "@/lib/ic-deck/reference";

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
  const [references, setReferences] = useState<Array<{ id: string; file_name: string }>>([]);
  const [referenceId, setReferenceId] = useState("");
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pendingBuild, setPendingBuild] = useState(false);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    let active = true;
    setLoadingSaved(true);
    fetch(`/api/deals/${dealId}/ic-deck`, { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!active) return;
      setReferences(body.references ?? []);
      setReferenceId(body.references?.find((ref: { file_name: string }) => ref.file_name.startsWith("IC Source - "))?.id ?? "");
      if (!response.ok) throw new Error(body.error);
      if (body.saved) { setModel(body.saved.model); setSavedVersion(body.saved.version); }
    }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoadingSaved(false); });
    return () => { active = false; };
  }, [dealId]);

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
      return true;
    } catch (e: any) {
      setError(e.message);
      setPendingBuild(false); setProgress("");
      return false;
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
      setSavedVersion(null);
    } catch (e: any) {
      setError(e?.message ?? "Could not read that workbook.");
    } finally {
      setReading(false);
    }
  }

  async function attachReference(file: File | undefined) {
    if (!file || !model) return;
    setUploading(true); setError(null);
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error("Source decks are limited to 50 MB.");
      validateReference(new Uint8Array(await file.arrayBuffer()), model.property.address ?? "");
      const vault = `/api/deals/${dealId}/vault`;
      const request = async (body: object) => {
        const response = await fetch(vault, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
      };
      const signed = await request({ action: "upload-url", fileName: file.name });
      const { error: uploadError } = await getSupabaseBrowserClient().storage.from("documents").uploadToSignedUrl(signed.path, signed.token, file);
      if (uploadError) throw uploadError;
      const sourceName = `IC Source - ${file.name}`;
      const doc = await request({ action: "register", path: signed.path, fileName: sourceName, docType: "other" });
      setReferences(prev => [{ id: doc.id, file_name: sourceName }, ...prev]); setReferenceId(doc.id);
      setProgress("Source exhibits saved to this deal. They can be reused on the next build.");
    } catch (error) { setError((error as Error).message); } finally { setUploading(false); }
  }

  useEffect(() => {
    if (!pendingBuild) return;
    if (run?.status === "completed") { setPendingBuild(false); void build(run.id); }
    if (run?.status === "failed") { setPendingBuild(false); setError("Research failed. Retry research, or turn off the research draft to build from the recorded inputs."); setProgress(""); }
  }, [pendingBuild, run?.status]);

  async function build(completedRunId?: string) {
    if (!model) return;
    setBuilding(true);
    setError(null);
    setProgress("Assembling 24 slides: model tables, maps, comps, portfolio and source exhibits…");
    try {
      const res = await fetch(`/api/deals/${dealId}/ic-deck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: savedVersion == null ? model : null, referenceId: referenceId || null, delivery: "vault", narrativeRunId: completedRunId || (useDraft && run?.status === "completed" ? run.id : null) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Deck build failed (${res.status}).`);
      const result = await res.json();
      if (Array.isArray(result.warnings)) setModel(previous => previous ? { ...previous, warnings: result.warnings } : previous);
      const a = document.createElement("a");
      a.href = result.url;
      a.download = result.fileName;
      a.click();
      setProgress("Executive summary saved in Documents and downloaded. Review model checks and retained source exhibits before circulating.");
    } catch (e: any) {
      setError(e.message);
      setProgress("");
    } finally {
      setBuilding(false);
    }
  }

  async function automate() {
    if (!referenceId && useDraft && run?.status !== "completed") {
      setProgress("Researching location, zoning, tenant and market. The deck will build when research finishes.");
      if (!run || !["queued", "processing"].includes(run.status)) {
        if (await startNarrative()) setPendingBuild(true);
      } else setPendingBuild(true);
      return;
    }
    await build();
  }

  const price = model?.capitalization.find((c) => /price/i.test(c.label))?.amount ?? null;

  return (
    <section className="panel" aria-labelledby="ic-deck-builder-heading">
      <h2 id="ic-deck-builder-heading">Executive Summary — Build The Full Deck</h2>
      <p className="hint">
        Build the 24-slide Aldine-format executive summary from the saved underwriting model and live deal records.
        Returns, rent roll, cash flow and sensitivities come from Excel; comps, maps, portfolio and terms come from Hopper.
        Attach this property’s existing executive summary once to retain its photos, tenant overview, market canvas and diligence budget.
      </p>
      {loadingSaved && <p role="status">Loading the current saved underwriting model…</p>}
      {savedVersion != null && <p className="hint">Using saved UW version {savedVersion}. Choose a local workbook below only to use a different model.</p>}
      <label>
        {model ? "Use a different acquisition model (optional)" : "Acquisition model — upload the current workbook"}
        <input type="file" accept=".xlsx,.xlsm" disabled={loadingSaved || reading || building || pendingBuild} onChange={(e) => choose(e.target.files?.[0])} />
      </label>
      {reading && <p role="status">Reading the model…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {model && (
        <div aria-live="polite">
          <p>
            <strong>{model.property.address ?? "Unknown property"}</strong>
            {model.source.modelDate ? ` · model as of ${model.source.modelDate}` : ""}
          </p>
          <div className="panel-inset">
            <label>Saved source exhibits
              <select value={referenceId} disabled={building || uploading || pendingBuild} onChange={event => setReferenceId(event.target.value)}>
                <option value="">Build new exhibits; flag missing source evidence</option>
                {references.map(ref => <option key={ref.id} value={ref.id}>{ref.file_name}</option>)}
              </select>
            </label>
            <label>Attach this property’s executive summary (.pptx), once
              <input type="file" accept=".pptx" disabled={building || uploading || pendingBuild} onChange={event => void attachReference(event.target.files?.[0])} />
            </label>
            <p className="hint">{referenceId ? "Retains photos, tenant, market canvas, portfolio financial exhibits and budget as source snapshots (slides 3–7, 12–15, 21–22 and 24). Refreshes underwriting tables, comps, portfolio map and pursuit terms. Review source dates, portfolio values and budget quotes." : "Without a source deck, research drafts the narrative; site photos, the market-canvas survey, portfolio financial model and budget quotes remain explicit evidence requests."}</p>
            <label><input type="checkbox" checked={useDraft} disabled={pendingBuild || building} onChange={event => setUseDraft(event.target.checked)} /> Research missing narrative automatically before building</label>
          </div>
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
          <button type="button" onClick={automate} disabled={building || uploading || pendingBuild}>
            {building ? "Building executive summary…" : pendingBuild ? "Researching executive summary…" : "Build executive summary (.pptx)"}
          </button>
          {progress && <p role="status">{progress}</p>}
        </div>
      )}
    </section>
  );
}
