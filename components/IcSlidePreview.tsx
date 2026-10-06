"use client";
// components/IcSlidePreview.tsx
//
// Live preview of the IC summary slide plus Copy Link and Download .pptx.
// Renders the same SummarySlideModel that toPptx() writes, from the same
// tokens, so what you see is what IC gets. The recommendation is edited right
// on the slide and saved to the deal.

import { useState } from "react";
import { CircleCheck, CircleAlert } from "lucide-react";
import { hex, signal } from "@/lib/hopper-tokens";
import { MAP_H, MAP_W, RING_OFF, RING_ON, toPptx, type SummarySlideModel } from "@/lib/ic-deck/summary-slide";

export default function IcSlidePreview({
  dealId,
  model,
  missing,
}: {
  dealId: string;
  model: SummarySlideModel;
  missing: string[];
}) {
  const [rec, setRec] = useState(model.recommendation);
  const [saved, setSaved] = useState(model.recommendation);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  async function saveRec() {
    if (rec === saved) return;
    setBusy("save");
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_milestones", icRecommendation: rec }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save");
      setSaved(rec);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy("");
    }
  }

  async function download() {
    setBusy("pptx");
    setMsg("");
    try {
      await saveRec();
      await toPptx({ ...model, recommendation: rec });
      fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "log_ic_export", kind: "summary_slide", view: window.location.search }),
      }).catch(() => {});
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy("");
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMsg("Link copied: it opens this exact slide.");
    } catch {
      setMsg(window.location.href);
    }
  }

  return (
    <>
      <div className="toolbar" style={{ gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 220 }}>
          <span style={{ font: "800 20px/1 var(--font-display)", letterSpacing: "-.02em", color: "#0A2540" }}>IC Summary Slide</span>
          <span className="hint" style={{ margin: 0, fontSize: 12 }}>
            Built from live deal data · map follows the Demand Map tab ({model.radius} mi)
          </span>
        </div>
        {missing.length ? (
          <span style={{ display: "flex", alignItems: "center", gap: 6, font: "500 12px/1.3 var(--font-body)", color: "#C9862B" }} title={missing.join(", ")}>
            <CircleAlert size={16} color="#C9862B" />
            Missing: {missing.join(", ")}
          </span>
        ) : (
          <span style={{ display: "flex", alignItems: "center", gap: 6, font: "500 12px/1 var(--font-body)", color: "#2E7D5B" }}>
            <CircleCheck size={16} color="#2E7D5B" />
            All fields complete
          </span>
        )}
        <button type="button" className="btn btn-secondary" onClick={copyLink}>
          Copy Link
        </button>
        <button type="button" className="btn btn-primary" onClick={download} disabled={!!busy}>
          {busy === "pptx" ? "Building…" : "Download .pptx"}
        </button>
      </div>
      {msg && <p className="hint" style={{ padding: "8px 28px 0", margin: 0 }}>{msg}</p>}

      <div className="ic-stage">
        <div className="slide-scale">
          <div className="slide">
            <div className="slide-top">
              <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
                <span style={{ font: "600 10px/1 var(--font-body)", letterSpacing: ".16em", textTransform: "uppercase", color: "#4E9FD6" }}>{model.eyebrow}</span>
                <span style={{ font: "800 24px/1 var(--font-display)", letterSpacing: "-.02em", color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{model.title}</span>
              </div>
              <img src="/logo-white.svg" alt="Dalfen" style={{ height: 15, width: "auto" }} />
            </div>
            <div className="slide-body">
              <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                <div className="slide-kpis">
                  {model.kpis.map((k) => {
                    const s = k.tone ? signal[k.tone] : null;
                    return (
                      <div key={k.label} className="slide-kpi" style={s ? { background: hex(s.bg), borderColor: hex(s.fg) } : undefined}>
                        <span style={s ? { color: hex(s.fg) } : undefined}>{k.label}</span>
                        <b style={s ? { color: hex(s.fg), fontSize: 22, fontWeight: 700 } : undefined}>{k.value}</b>
                      </div>
                    );
                  })}
                </div>
                <span style={{ font: "600 9px/1 var(--font-body)", letterSpacing: ".14em", textTransform: "uppercase", color: "#0A2540" }}>Site viability</span>
                <div className="slide-flags">
                  {model.flags.map((f) => {
                    const s = signal[f.state];
                    return (
                      <div key={f.key} className="slide-flag" style={{ background: hex(s.bg), borderTop: `3px solid ${hex(s.fg)}` }}>
                        <span className="t">
                          <b>{f.label}</b>
                          <em style={{ color: hex(s.fg) }}>{s.label}</em>
                        </span>
                        <span className="n">{f.note}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="slide-rec">
                  <span style={{ font: "600 8px/1 var(--font-body)", letterSpacing: ".14em", textTransform: "uppercase", color: "#0E5AA7" }}>
                    Recommendation {busy === "save" ? "· saving…" : rec !== saved ? "· unsaved" : ""}
                  </span>
                  <textarea
                    value={rec}
                    onChange={(e) => setRec(e.target.value)}
                    onBlur={saveRec}
                    maxLength={600}
                    placeholder="Click to write the recommendation, e.g. Approve LOI at $8.4M. Strong trucking demand within 3 mi."
                    aria-label="Recommendation"
                  />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <div className="slide-map">
                  {model.mapImages && (
                    <>
                      <img src={model.mapImages.imagery} alt="Satellite view of the site" style={{ position: "absolute", inset: 0 }} />
                      <img src={model.mapImages.roads} alt="" style={{ position: "absolute", inset: 0 }} />
                    </>
                  )}
                  <svg width={MAP_W} height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ display: "block", position: "relative" }}>
                    <defs>
                      <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
                        <path d="M30 0H0V30" fill="none" stroke="rgba(10,37,64,.05)" />
                      </pattern>
                    </defs>
                    {!model.mapImages && <rect width={MAP_W} height={MAP_H} fill="url(#grid)" />}
                    {model.rings.map((r) => (
                      <circle
                        key={r.miles}
                        cx={MAP_W / 2}
                        cy={MAP_H / 2}
                        r={r.r}
                        fill={r.on ? "rgba(78,159,214,.12)" : "none"}
                        stroke={hex(r.on ? RING_ON : RING_OFF)}
                        strokeOpacity={r.on ? 1 : 0.7}
                        strokeWidth={r.on ? 2 : 1}
                        strokeDasharray={r.on ? undefined : "3 3"}
                      />
                    ))}
                    {model.pins.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={hex(p.color)} stroke="#fff" strokeWidth={1} opacity={p.inside ? 1 : 0.28} />
                    ))}
                    <rect x={MAP_W / 2 - 6} y={MAP_H / 2 - 6} width={12} height={12} fill="#0A2540" stroke="#fff" strokeWidth={2} transform={`rotate(45 ${MAP_W / 2} ${MAP_H / 2})`} />
                  </svg>
                </div>
                <span style={{ font: "600 9px/1 var(--font-body)", letterSpacing: ".14em", textTransform: "uppercase", color: "#0A2540" }}>Tenant demand · {model.radius} mi</span>
                {model.demandRows.slice(0, 7).map((r) => {
                  const on = model.activeCats.includes(r.key);
                  return (
                    <div key={r.key} className="sbar" style={{ opacity: on ? 1 : 0.4 }}>
                      <span>{r.label}</span>
                      <div className="tr">
                        <div style={{ width: `${Math.round(r.share * 100)}%`, background: hex(r.color) }} />
                      </div>
                      <b>{r.count}</b>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="slide-foot">
              <span>{model.footerLeft}</span>
              <span className="mono">{model.footerRight}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
