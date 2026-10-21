"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PORTFOLIO_STAGES, pricedPortfolioAssets } from "@/lib/portfolio-stages";

type Asset = { id: string; label: string; stage: string; allocatedPrice: number | null };
export default function PortfolioStageControl({ portfolioId, assets }: { portfolioId: string; assets: Asset[] }) {
  const router = useRouter();
  const [target, setTarget] = useState(() => PORTFOLIO_STAGES.find((stage) => pricedPortfolioAssets(assets, stage.value).length)?.value ?? "uw");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [ddEndOn, setDdEndOn] = useState("");
  const [closingOn, setClosingOn] = useState("");
  const [psaEffectiveOn, setPsaEffectiveOn] = useState("");
  const [closedOn, setClosedOn] = useState("");
  const [closedPrices, setClosedPrices] = useState<Record<string, string>>({});
  const chosen = pricedPortfolioAssets(assets, target);
  const total = chosen.reduce((sum, a) => sum + Number(a.allocatedPrice), 0);
  const targetLabel = PORTFOLIO_STAGES.find((s) => s.value === target)?.label;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setResult(null);
    try {
      const response = await fetch(`/api/deal-portfolios/${portfolioId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "change_stage", selection: "priced", selectedDealIds: chosen.map((a) => a.id), toStage: target, ddEndOn, closingOn, psaEffectiveOn, closedOn,
          closedPrices }),
      });
      const out = await response.json();
      if (!response.ok) throw new Error(out.error ?? "Stage update failed");
      setResult(`Moved ${out.moved} asset${out.moved === 1 ? "" : "s"} to ${targetLabel}. ${[...out.skipped, ...out.failed, ...out.warnings].join(" ")}`);
      router.refresh();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="portfolio-move">
    <form onSubmit={submit}>
      <fieldset disabled={busy} className="portfolio-move-fields">
        <div className="portfolio-move-summary">
          <strong>{chosen.length} priced asset{chosen.length === 1 ? "" : "s"} ready to move</strong>
          <span className="muted">${total.toLocaleString("en-US", { maximumFractionDigits: 0 })} total allocation</span>
        </div>
        <label className="portfolio-move-target">Move to
          <select value={target} onChange={(e) => { setTarget(e.target.value); setResult(null); setError(null); }}>
            {PORTFOLIO_STAGES.filter((s) => s.value !== "prospect").map((stage) => <option key={stage.value} value={stage.value} disabled={!pricedPortfolioAssets(assets, stage.value).length}>{stage.label} ({pricedPortfolioAssets(assets, stage.value).length})</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy || !chosen.length}>{busy ? "Moving…" : `Move priced assets to ${targetLabel}`}</button>
        {target === "due_diligence" && <div className="grid-2 portfolio-move-dates">
          <label>PSA effective date<input type="date" value={psaEffectiveOn} onChange={(e) => setPsaEffectiveOn(e.target.value)} /></label>
          <label>DD ends<input type="date" value={ddEndOn} onChange={(e) => setDdEndOn(e.target.value)} /></label>
          <label>Target closing date<input type="date" value={closingOn} onChange={(e) => setClosingOn(e.target.value)} /></label>
        </div>}
        {target === "closed" && <div className="portfolio-move-dates">
          <label>Closing date<input type="date" required value={closedOn} onChange={(e) => setClosedOn(e.target.value)} /></label>
          {chosen.map((asset) => <label key={asset.id}>{asset.label} — closing price ($)<input required value={closedPrices[asset.id] ?? ""} onChange={(e) => setClosedPrices((prices) => ({ ...prices, [asset.id]: e.target.value }))} /></label>)}
        </div>}
      </fieldset>
    </form>
    <p className="hint">Save an allocated price in the table to include an asset. Unpriced assets stay in their current stage.</p>
    {result && <p role="status">{result}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
