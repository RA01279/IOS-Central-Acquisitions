"use client";
// components/MarketReportUpload.tsx
//
// Upload a broker market report PDF: the file goes to storage, its text is
// read in the browser, the Hopper helper extracts the statistics and
// takeaways (market-report agent), and the result is shown for review --
// market, submarkets, period, every statistic -- before it is saved.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { pdfText } from "@/lib/pdf-text";
import { runAgent, helperOnline } from "@/lib/agent-client";
import { MARKET_METRICS, METRIC_LABELS, parseMarketReport, type MarketMetric, type MarketReport } from "@/lib/agents/market-report";

const BASIS_LABELS: Record<string, string> = { current: "Current", average: "Average", prior_period: "Prior period", year_ago: "Year ago", forecast: "Forecast", peak: "Peak" };

export default function MarketReportUpload() {
  const router = useRouter();
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [file, setFile] = useState<{ path: string; name: string; pages: number } | null>(null);
  const [draft, setDraft] = useState<MarketReport | null>(null);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void helperOnline().then((o) => alive.current && setOnline(o));
    return () => { alive.current = false; };
  }, []);

  async function read(f: File) {
    setError(null);
    setSaved(null);
    setDraft(null);
    try {
      if (!/\.pdf$/i.test(f.name)) throw new Error("Choose the report as a PDF.");
      setStep("Uploading…");
      const slot = await fetch("/api/market-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "upload-url", fileName: f.name }) });
      const s = await slot.json().catch(() => ({}));
      if (!slot.ok) throw new Error(s.error ?? "Couldn't start the upload");
      const { error: upErr } = await getSupabaseBrowserClient().storage.from("documents").uploadToSignedUrl(s.path, s.token, f, { contentType: "application/pdf" });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      setStep("Reading the PDF…");
      const pdf = await pdfText(await f.arrayBuffer(), 95000, 60);
      if (pdf.scanned) throw new Error("This PDF is scanned images with no text layer, so it can't be read.");
      setStep("Reading the report with the Hopper helper… (usually under a minute)");
      const report = parseMarketReport(await runAgent("market-report", `MARKET REPORT (${f.name}, ${pdf.pages} pages):\n${pdf.text}`, { alive: () => alive.current }));
      if (!report) throw new Error("Couldn't read a market and statistics from that report.");
      setFile({ path: s.path, name: f.name, pages: pdf.pages });
      setDraft(report);
      setKeep(report.metrics.map(() => true));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStep(null);
    }
  }

  async function save() {
    if (!draft || !file) return;
    setStep("Saving…");
    setError(null);
    try {
      const res = await fetch("/api/market-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", path: file.path, fileName: file.name, pages: file.pages, report: { ...draft, metrics: draft.metrics.filter((_, i) => keep[i]) } }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error ?? "Save failed");
      setSaved(`${draft.publisher} ${draft.period} — ${draft.submarkets.join(", ") || draft.market} saved with ${keep.filter(Boolean).length} statistics.`);
      setDraft(null);
      setFile(null);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStep(null);
    }
  }

  const set = (patch: Partial<MarketReport>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setMetric = (i: number, patch: Partial<MarketReport["metrics"][number]>) =>
    setDraft((d) => (d ? { ...d, metrics: d.metrics.map((m, j) => (j === i ? { ...m, ...patch } : m)) } : d));

  return (
    <div className="inline-add-form" style={{ width: "100%" }}>
      <label>
        Upload a broker market report (PDF)
        <input type="file" accept="application/pdf,.pdf" disabled={step !== null || online === false}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} />
      </label>
      {online === false && <p className="error">The Hopper helper is offline. Start it from your desktop, then upload.</p>}
      {step && <p className="hint">{step}</p>}
      {saved && <p className="hint"><strong>Saved:</strong> {saved}</p>}
      {error && <p className="error">{error}</p>}

      {draft && (
        <>
          <div className="grid-2">
            <label>Publisher<input value={draft.publisher} onChange={(e) => set({ publisher: e.target.value })} /></label>
            <label>Period<input value={draft.period} onChange={(e) => set({ period: e.target.value })} placeholder="Q2 2026" /></label>
            <label>Period ends<input type="date" value={draft.periodEnd ?? ""} onChange={(e) => set({ periodEnd: e.target.value || null })} /></label>
            <label>
              Property type
              <select value={draft.propertyType} onChange={(e) => set({ propertyType: e.target.value as MarketReport["propertyType"] })}>
                <option value="industrial">Industrial</option><option value="ios">IOS</option><option value="flex">Flex</option><option value="office">Office</option><option value="other">Other</option>
              </select>
            </label>
            <label>Market<input value={draft.market} onChange={(e) => set({ market: e.target.value })} /></label>
            <label>Submarkets (comma separated)<input value={draft.submarkets.join(", ")} onChange={(e) => set({ submarkets: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></label>
          </div>
          {draft.geography && <p className="hint" style={{ margin: 0 }}>Survey: {draft.geography}</p>}
          <label>Summary<textarea rows={3} value={draft.summary} onChange={(e) => set({ summary: e.target.value })} /></label>
          {draft.takeaways.length > 0 && (
            <div>
              <span className="label">Broker takeaways</span>
              <ul style={{ margin: "4px 0" }}>{draft.takeaways.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table className="summary-table">
              <thead><tr><th></th><th>Label</th><th>Type</th><th>Value</th><th>Submarket</th><th>Segment</th><th>Basis</th></tr></thead>
              <tbody>
                {draft.metrics.map((m, i) => (
                  <tr key={i} style={{ opacity: keep[i] ? 1 : 0.45 }}>
                    <td><input type="checkbox" checked={keep[i]} onChange={(e) => setKeep((k) => k.map((v, j) => (j === i ? e.target.checked : v)))} aria-label={`Keep ${m.label}`} /></td>
                    <td><input value={m.label} style={{ minWidth: 200 }} onChange={(e) => setMetric(i, { label: e.target.value })} aria-label="Label" /></td>
                    <td>
                      <select value={m.metric} onChange={(e) => setMetric(i, { metric: e.target.value as MarketMetric })} aria-label="Statistic type">
                        {MARKET_METRICS.map((k) => <option key={k} value={k}>{METRIC_LABELS[k] ?? k}</option>)}
                      </select>
                    </td>
                    <td>
                      {/* Parsed when you leave the box, so "0." or a cleared box can be typed through. */}
                      <input key={`${i}-${m.value}`} defaultValue={String(m.value)} style={{ width: 110 }} aria-label="Value"
                        onBlur={(e) => { const v = Number(e.target.value.replace(/[$,%\s]/g, "")); if (Number.isFinite(v) && e.target.value.trim() !== "") setMetric(i, { value: v }); else e.target.value = String(m.value); }} />
                    </td>
                    <td><input value={m.submarket ?? ""} placeholder="All" style={{ width: 110 }} onChange={(e) => setMetric(i, { submarket: e.target.value || null })} aria-label="Submarket" /></td>
                    <td><input value={m.segment ?? ""} placeholder="All" style={{ width: 110 }} onChange={(e) => setMetric(i, { segment: e.target.value || null })} aria-label="Segment" /></td>
                    <td>
                      <select value={m.basis} onChange={(e) => setMetric(i, { basis: e.target.value as MarketReport["metrics"][number]["basis"] })} aria-label="Basis">
                        {Object.entries(BASIS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="stage-actions" style={{ marginBottom: 0 }}>
            <button type="button" className="secondary"
              onClick={() => {
                setDraft((d) => d ? { ...d, metrics: [...d.metrics, { metric: "other", label: "New statistic", value: 0, submarket: d.submarkets.length === 1 ? d.submarkets[0] : null, segment: null, basis: "current", period: d.period || null }] } : d);
                setKeep((k) => [...k, true]);
              }}>
              + Add statistic
            </button>
          </div>
          {draft.transactions.length > 0 && <p className="hint" style={{ margin: 0 }}>Deals named: {draft.transactions.map((t) => `${t.party}${t.sf ? ` (${t.sf.toLocaleString()} SF)` : ""}`).join("; ")}</p>}
          {draft.notes.length > 0 && <div className="warning"><ul>{draft.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}
          <div className="stage-actions" style={{ marginBottom: 0 }}>
            <button type="button" disabled={step !== null || !draft.market.trim()} onClick={() => void save()}>Save report</button>
            <button type="button" className="secondary" onClick={() => { setDraft(null); setFile(null); }}>Discard</button>
            <span className="hint">Percents are entered as percents (2.3 = 2.3%), SF as square feet, rents in dollars.</span>
          </div>
        </>
      )}
    </div>
  );
}
