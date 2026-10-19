"use client";
// components/MarketNarrativePanel.tsx
//
// The written read of a market or submarket, built from the broker reports on
// file and Hopper's comps (market-narrative agent). Pick an area, read its
// latest narrative with sources, or write / refresh it.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { runAgent } from "@/lib/agent-client";

export type Area = { market: string; submarket: string | null; reports: number };
export type SavedNarrative = {
  market: string;
  submarket: string | null;
  headline: string;
  narrative: string;
  points: { text: string; sources: string[] }[];
  conflicts: string[];
  gaps: string[];
  sources: { label: string; reportId: string; publisher: string; period: string | null }[];
  generated_at: string;
};

const key = (m: string, s: string | null) => `${m.toLowerCase()}|${(s ?? "").toLowerCase()}`;

export default function MarketNarrativePanel({ areas, narratives, initial }: { areas: Area[]; narratives: SavedNarrative[]; initial?: string | null }) {
  const router = useRouter();
  const [pick, setPick] = useState(() => {
    const first = areas.find((a) => a.submarket && initial && a.market.toLowerCase() === initial.toLowerCase()) ?? areas.find((a) => a.submarket) ?? areas[0];
    return first ? key(first.market, first.submarket) : "";
  });
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const area = areas.find((a) => key(a.market, a.submarket) === pick) ?? null;
  const saved = area ? narratives.find((n) => key(n.market, n.submarket) === pick) ?? null : null;

  async function write() {
    if (!area) return;
    setError(null);
    try {
      setStep("Gathering the reports and comps…");
      const evRes = await fetch("/api/market-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "evidence", market: area.market, submarket: area.submarket }) });
      const ev = await evRes.json().catch(() => ({}));
      if (!evRes.ok) throw new Error(ev.error ?? "Couldn't gather the evidence");
      setStep("Writing the narrative with the Hopper helper… (usually a minute or two)");
      const report = await runAgent("market-narrative", ev.text, { alive: () => alive.current });
      setStep("Saving…");
      const res = await fetch("/api/market-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-narrative", market: area.market, submarket: area.submarket, report }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error ?? "Save failed");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStep(null);
    }
  }

  if (!areas.length) return <p className="hint">Upload a broker market report below to start a narrative.</p>;
  const sourceLabel = (l: string) => {
    const s = saved?.sources.find((x) => x.label === l);
    return s ? `${l}: ${s.publisher}${s.period ? ` ${s.period}` : ""}` : l;
  };

  return (
    <div>
      <div className="stage-actions">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Market or submarket">
          {areas.map((a) => (
            <option key={key(a.market, a.submarket)} value={key(a.market, a.submarket)}>
              {a.submarket ? `${a.submarket} (${a.market})` : `${a.market} — whole market`} · {a.reports} report{a.reports === 1 ? "" : "s"}
            </option>
          ))}
        </select>
        <button type="button" disabled={step !== null || !area} onClick={() => void write()}>{saved ? "Refresh narrative" : "Write narrative"}</button>
        {step && <span className="hint">{step}</span>}
      </div>
      {error && <p className="error">{error}</p>}
      {saved ? (
        <div className="card" style={{ gap: 8 }}>
          <strong>{saved.headline}</strong>
          {saved.narrative.split(/\n{2,}/).map((p, i) => <p key={i} style={{ margin: 0 }}>{p}</p>)}
          {saved.points.length > 0 && (
            <>
              <span className="label">Key points</span>
              <ul style={{ margin: 0 }}>
                {saved.points.map((p, i) => <li key={i}>{p.text} <span className="muted">({p.sources.join(", ")})</span></li>)}
              </ul>
            </>
          )}
          {saved.conflicts.length > 0 && <div className="warning"><strong>Where sources differ</strong><ul style={{ margin: 0 }}>{saved.conflicts.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
          {saved.gaps.length > 0 && <p className="hint" style={{ margin: 0 }}>Not covered: {saved.gaps.join(" · ")}</p>}
          <p className="hint" style={{ margin: 0 }}>
            Sources: {saved.sources.map((s) => (
              <span key={s.label}><a href={`/api/market-reports?doc=${s.reportId}`} target="_blank" rel="noreferrer">{sourceLabel(s.label)}</a> · </span>
            ))}
            Hopper comps · written {new Date(saved.generated_at).toLocaleDateString("en-US")}
          </p>
        </div>
      ) : (
        <p className="hint">No narrative for this area yet. Write one from its {area?.reports ?? 0} report{area?.reports === 1 ? "" : "s"} and Hopper&apos;s comps.</p>
      )}
    </div>
  );
}
