"use client";

import { useEffect, useRef, useState } from "react";
import { saleComparison, transactionUpdate } from "@/lib/asset-transactions";
import type { AssetDetail } from "./AssetsView";

export default function AssetTransactionEditor({ asset, recordSale, onCancel, onSaved }: {
  asset: AssetDetail; recordSale: boolean; onCancel: () => void; onSaved: (status: string) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [form, setForm] = useState({
    status: recordSale ? "sold" : asset.status,
    purchasePrice: asset.purchase_price == null ? "" : String(asset.purchase_price),
    purchasedOn: asset.purchased_on || "",
    salePrice: asset.sale_price == null ? "" : String(asset.sale_price),
    soldOn: asset.sold_on || "",
    acquisitionCosts: asset.acquisition_costs == null ? "" : String(asset.acquisition_costs),
    sellingCosts: asset.selling_costs == null ? "" : String(asset.selling_costs),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { panel.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, []);
  let comparison = null;
  try { comparison = saleComparison({ ...asset, ...transactionUpdate(form, asset) }); } catch { /* Incomplete fields while typing. */ }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try { transactionUpdate(form, asset); } catch (error) { setError(error instanceof Error ? error.message : "Check transaction details."); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/assets/${asset.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save transaction details.");
      onSaved(form.status);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save."); }
    finally { setBusy(false); }
  }

  return <section ref={panel} className="panel" aria-label={`Purchase and sale for ${asset.address}`}>
    <h2>{recordSale ? "Record sale" : "Purchase and sale"} — {asset.address}</h2>
    <form onSubmit={save}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <label>Status<select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value, ...(e.target.value === "owned" ? { salePrice: "", soldOn: "", sellingCosts: "" } : {}) }))}>
            <option value="owned">Owned</option><option value="sold">Sold</option>
          </select></label>
          <label>Purchase price ($)<input inputMode="decimal" placeholder="2,000,000" value={form.purchasePrice} onChange={e => setForm(f => ({ ...f, purchasePrice: e.target.value }))} /></label>
          <label>Purchase date<input type="date" value={form.purchasedOn} onChange={e => setForm(f => ({ ...f, purchasedOn: e.target.value }))} /></label>
          <label>Acquisition costs ($)<input inputMode="decimal" placeholder="Enter total costs, or 0" value={form.acquisitionCosts} onChange={e => setForm(f => ({ ...f, acquisitionCosts: e.target.value }))} /></label>
          {form.status === "sold" && <>
            <label>Sale price ($)<input inputMode="decimal" placeholder="2,500,000" required value={form.salePrice} onChange={e => setForm(f => ({ ...f, salePrice: e.target.value }))} /></label>
            <label>Sale date<input type="date" required value={form.soldOn} onChange={e => setForm(f => ({ ...f, soldOn: e.target.value }))} /></label>
            <label>Selling costs ($)<input inputMode="decimal" placeholder="Enter total costs, or 0" value={form.sellingCosts} onChange={e => setForm(f => ({ ...f, sellingCosts: e.target.value }))} /></label>
          </>}
        </div>
        {comparison && <div role="status"><p>Price-only change: <strong>{comparison.change < 0 ? "−" : "+"}${Math.abs(comparison.change).toLocaleString()} ({comparison.percent.toFixed(1)}%)</strong></p>
          {comparison.netChange !== null && <p>Change after costs: <strong>{comparison.netChange < 0 ? "−" : "+"}${Math.abs(comparison.netChange).toLocaleString()} ({comparison.netPercent?.toFixed(1)}%)</strong><br />Acquisition basis: ${comparison.basis?.toLocaleString()} · Net sale proceeds: ${comparison.proceeds?.toLocaleString()}</p>}</div>}
        <p className="hint">Acquisition basis = purchase price + acquisition costs. Net sale proceeds = sale price − selling costs. Change after costs = net proceeds − acquisition basis; percentage uses acquisition basis. This excludes debt, operating income and capital improvements. Enter both costs, using 0 if none, to calculate the net change. Sold assets remain in history.</p>
        {asset.status === "sold" && form.status === "owned" && <p className="hint">Saving as owned clears the sale date, price and selling costs to correct the sale record.</p>}
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit">{busy ? "Saving…" : form.status === "sold" ? "Save sale" : "Save purchase details"}</button>{" "}
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </fieldset>
    </form>
  </section>;
}
