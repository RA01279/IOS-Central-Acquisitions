"use client";
import { useEffect, useState } from "react";
import { parseMemo } from "@/lib/agents/memo";
import MemoPreview from "./MemoPreview";
import { AGENTS, type AgentId } from "@/lib/agents/catalog";
type Run = { id: string; agent: string; status: string; created_at: string; error?: string; result?: { report: string; limitations: string[] }; sources?: { label: string; href?: string }[] };
type Deal = { id: string; properties: { address?: string } | null };
function ReportText({ text }: { text: string }) {
  // Render links without accepting raw model-generated HTML or script URLs.
  return <>{text.split(/(\[[^\]\n]+\]\((?:https?:\/\/|\/(?!\/))[^\s)]+\))/g).map((part, i) => {
    const link = part.match(/^\[([^\]\n]+)\]\(([^\s)]+)\)$/);
    return link ? <a key={i} href={link[2]} target={link[2].startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">{link[1]}</a> : part;
  })}</>;
}
export default function AgentWorkspace() {
  const [agent, setAgent] = useState<AgentId>("comp-analyst");
  const [deal, setDeal] = useState(""); const [text, setText] = useState("");
  const [runs, setRuns] = useState<Run[]>([]); const [deals, setDeals] = useState<Deal[]>([]);
  const [online, setOnline] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [selected, setSelected] = useState(""); const [report, setReport] = useState<Run | null>(null);
  const definition = AGENTS.find(a => a.id === agent)!;
  const memo = report?.agent === "investment-memo" && report.result ? parseMemo(report.result.report) : null;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if(params.get("agent")==="site-research" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.get("deal")??"")) {
      setAgent("site-research");setDeal(params.get("deal")!);
      if(params.get("task")==="zoning-ios") setText("Research subject zoning and neighboring IOS operators in the same municipality and zoning. Verify each address and designation with official municipal sources. Identify operator, business category and actual site use with primary business sources. Separate confirmed matches from unverified leads. No Zoneomics API is available.");
    }
    const id = params.get("run"); if (id) setSelected(id);
    let live = true;
    async function refresh() {
      try {
        const response = await fetch("/api/agents", { cache: "no-store" });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load agents.");
        if (live) { setRuns(data.runs); setDeals(data.deals); setOnline(data.online); }
      } catch (e) { if (live) { setOnline(false); setError(e instanceof Error ? e.message : "Could not load agents."); } }
    }
    void refresh(); const timer = setInterval(refresh, 5000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!selected) return;
    let live = true; setReport(null);
    async function refresh() {
      try {
        const response = await fetch(`/api/agents?id=${encodeURIComponent(selected)}`, { cache: "no-store" });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        if (live) setReport(data);
      } catch (e) { if (live) setError(e instanceof Error ? e.message : "Could not load report."); }
    }
    void refresh(); const timer = setInterval(refresh, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [selected]);
  function open(id: string) { setSelected(id); window.history.replaceState(null, "", `/agents?run=${encodeURIComponent(id)}`); }
  async function run() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent, dealId: deal || null, text }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      open(data.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start report."); }
    finally { setBusy(false); }
  }
  function download() {
    if (!report?.result) return;
    const blob = new Blob([report.result.report + "\n\nLimitations\n" + report.result.limitations.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `hopper-${report.agent}-${report.id}.md`; a.click(); URL.revokeObjectURL(url);
  }
  return <>
    <p className="muted">HOPPER / AGENTS</p><h1>Acquisitions assistants</h1>
    <p>Choose a task, add evidence, and review the report. Results are saved to your account.</p>
    <p role="status">{online ? "● Your computer is connected" : "○ Your computer helper is offline"}</p>
    {!online && <details><summary>Connect your computer</summary><p>Use the computer pairing in <a href="/comps">Comps</a>, then start the updated Hopper helper. Keep it running while reports are generated.</p><code>npm run outlook:helper -- --pair</code><p>Already paired? Run <code>npm run outlook:helper</code>.</p></details>}
    {error && <p role="alert" style={{ color: "#a32626" }}>{error}</p>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, margin: "24px 0" }}>
      {AGENTS.map(a => <button key={a.id} type="button" aria-pressed={agent === a.id} onClick={() => setAgent(a.id)} style={{ textAlign: "left", padding: 18, border: agent === a.id ? "2px solid #255a49" : "1px solid #ccc", background: agent === a.id ? "#eff6f2" : "white", color: "#172b24", borderRadius: 8 }}><strong>{a.name}</strong><p style={{ margin: "8px 0 0", fontWeight: 400 }}>{a.description}</p></button>)}
    </div>
    <section style={{ padding: 24, border: "1px solid #ddd", borderRadius: 8 }}><h2>{definition.name}</h2>
      {agent === "investment-memo" && <p>Creates a 25-slide PowerPoint matching your 12803 O’Connor executive summary. Paste tenant, market, lease and approved-model evidence here. Add maps and model screenshots to the completed report before downloading.</p>}
      <label htmlFor="agent-deal">Deal {definition.needsDeal ? "(required)" : "(optional)"}</label>
      <select id="agent-deal" value={deal} onChange={e => setDeal(e.target.value)} style={{ display: "block", width: "100%", margin: "8px 0 16px", padding: 10 }}><option value="">Select a deal</option>{deals.map(d => <option key={d.id} value={d.id}>{d.properties?.address || d.id}</option>)}</select>
      <label htmlFor="agent-text">Source text and context {agent === "deal-intake" ? "(required)" : "(optional)"}</label>
      <textarea id="agent-text" value={text} onChange={e => setText(e.target.value)} maxLength={100000} rows={7} style={{ display: "block", width: "100%", margin: "8px 0 12px", padding: 10 }} placeholder="Paste broker email, offering material, underwriting notes or diligence evidence. Identify the source and date." />
      <p className="muted">Uses recorded Hopper data and this text. Underwriting review does not execute your Excel model. Follow-ups and memos are drafts for your review.</p>
      <button type="button" onClick={run} disabled={busy || !online || (definition.needsDeal && !deal) || (agent === "deal-intake" && !text.trim())}>{busy ? "Preparing…" : "Generate report"}</button>
    </section>
    {report && <section aria-live="polite" style={{ marginTop: 28 }}><h2>{AGENTS.find(a => a.id === report.agent)?.name} report</h2><p>{report.status} · {new Date(report.created_at).toLocaleString()}</p>{report.error && <p role="alert">{report.error}</p>}
      {report.result && <>{memo ? <MemoPreview key={report.id} deck={memo} runId={report.id} /> : <><button onClick={download}>Download report</button><div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.65, background: "#fff", padding: 24, marginTop: 12 }}><ReportText text={report.result.report} /></div></>}<h3>Limitations</h3><ul>{report.result.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul><h3>Hopper sources</h3><ul>{report.sources?.map((s, i) => <li key={i}>{s.href?.startsWith("/") && !s.href.startsWith("//") ? <a href={s.href}>{s.label}</a> : s.label}</li>)}</ul></>}
    </section>}
    <section style={{ marginTop: 32 }}><h2>Your recent reports</h2>{!runs.length && <p>No reports yet.</p>}{runs.map(r => <p key={r.id}><button onClick={() => open(r.id)}>{AGENTS.find(a => a.id === r.agent)?.name} · {r.status} · {new Date(r.created_at).toLocaleString()}</button></p>)}</section>
  </>;
}
