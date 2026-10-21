"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PORTFOLIO_STAGES, portfolioStageAction } from "@/lib/portfolio-stages";

type Asset = { id: string; label: string; stage: string };
export default function PortfolioStageControl({ portfolioId, assets }: { portfolioId: string; assets: Asset[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(() => assets.filter((a) => !["archived", "closed"].includes(a.stage)).map((a) => a.id));
  const [target, setTarget] = useState("uw");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [ddEndOn, setDdEndOn] = useState("");
  const [closingOn, setClosingOn] = useState("");
  const [psaEffectiveOn, setPsaEffectiveOn] = useState("");
  const [closedOn, setClosedOn] = useState("");
  const [closedPrices, setClosedPrices] = useState<Record<string, string>>({});
  const chosen = assets.filter((a) => selected.includes(a.id));
  const invalid = chosen.filter((a) => portfolioStageAction(a.stage, target).error);
  const changes = chosen.filter((a) => a.stage !== target);
  const backward = changes.some((a) => portfolioStageAction(a.stage, target).correction);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setResult(null);
    try {
      const response = await fetch(`/api/deal-portfolios/${portfolioId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "change_stage", selectedDealIds: selected, toStage: target, ddEndOn, closingOn, psaEffectiveOn, closedOn, closedPrices }),
      });
      const out = await response.json();
      if (!response.ok) throw new Error(out.error ?? "Stage update failed");
      setResult(`Moved ${out.moved} asset${out.moved === 1 ? "" : "s"}. ${[...out.skipped, ...out.failed, ...out.warnings].join(" ")}`);
      router.refresh();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel">
    <h2>Portfolio stage</h2>
    <p className="hint">Move the whole portfolio or selected assets. Each asset keeps its own stage; forward moves follow the pipeline one stage at a time.</p>
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend>Assets to move ({selected.length} selected)</legend>
        <div className="stage-actions">
          <button type="button" className="secondary" onClick={() => setSelected(assets.filter((a) => a.stage !== "archived").map((a) => a.id))}>Select all</button>
          <button type="button" className="secondary" onClick={() => setSelected([])}>Clear selection</button>
        </div>
        {assets.map((a) => <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" disabled={a.stage === "archived"} checked={selected.includes(a.id)} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, a.id] : ids.filter((id) => id !== a.id))} />
          {a.label} — {PORTFOLIO_STAGES.find((s) => s.value === a.stage)?.label ?? a.stage}
        </label>)}
        <label>Move selected assets to
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {PORTFOLIO_STAGES.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
          </select>
        </label>
        {invalid.length > 0 && <p className="warning">{invalid.length} selected asset(s) cannot move to this stage. Advance one stage at a time, or narrow the selection. Restore archived assets first.</p>}
        {backward && <p className="warning">This corrects stages backward. Moving out of Closed clears the selected assets&apos; recorded closing dates and prices.</p>}
        {target === "due_diligence" && !backward && <div className="grid-2">
          <label>PSA effective date<input type="date" value={psaEffectiveOn} onChange={(e) => setPsaEffectiveOn(e.target.value)} /></label>
          <label>DD ends<input type="date" value={ddEndOn} onChange={(e) => setDdEndOn(e.target.value)} /></label>
          <label>Target closing date<input type="date" value={closingOn} onChange={(e) => setClosingOn(e.target.value)} /></label>
        </div>}
        {target === "closed" && <>
          <label>Closing date<input type="date" required value={closedOn} onChange={(e) => setClosedOn(e.target.value)} /></label>
          <p className="hint">Closing prices are required for each asset&apos;s closed reporting. These do not appear in the portfolio LOI.</p>
          {changes.map((a) => <label key={a.id}>{a.label} — closing price ($)<input required value={closedPrices[a.id] ?? ""} onChange={(e) => setClosedPrices((prices) => ({ ...prices, [a.id]: e.target.value }))} /></label>)}
        </>}
        <button type="submit" disabled={busy || !changes.length || !!invalid.length}>{busy ? "Moving assets…" : `Move ${changes.length} asset${changes.length === 1 ? "" : "s"} to ${PORTFOLIO_STAGES.find((s) => s.value === target)?.label}`}</button>
      </fieldset>
    </form>
    {result && <p role="status">{result}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
