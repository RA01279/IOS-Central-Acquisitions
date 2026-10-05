// /deals/compare?ids=a,b,c -- up to four sites side by side: score, the KPIs,
// the six flags and tenant demand. The best figure in each row is green.

import { getServiceClient } from "@/lib/supabase";
import { DEAL_CARD_SELECT, toDealCard } from "@/lib/deal-view";
import { loadDemandSnapshot, loadSignals } from "@/lib/site-signals";
import { demandBreakdown } from "@/lib/site-score";
import { fmtPct } from "@/lib/format";
import { hex, signal } from "@/lib/hopper-tokens";
import Nav from "@/components/Nav";
import { Badge, DemandBars, FlagCellBody, ScoreTile, STAGE_TONES } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compare Sites" };

export default async function ComparePage(props: { searchParams: Promise<{ ids?: string }> }) {
  const sp = await props.searchParams;
  const ids = (sp.ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
    .slice(0, 4);

  const supabase = getServiceClient();
  const { data: rows } = ids.length
    ? await supabase.from("deals").select(`${DEAL_CARD_SELECT}, uw_versions(version_number, returns_summary)`).in("id", ids)
    : { data: [] as any[] };
  const signals = await loadSignals(ids);
  const snapshots = await Promise.all(ids.map((id) => loadDemandSnapshot(id)));

  const cols = ids
    .map((id, i) => {
      const d = (rows ?? []).find((r: any) => r.id === id);
      if (!d) return null;
      const card = toDealCard(d, signals.get(id));
      const latest = [...((d as any).uw_versions ?? [])].sort((a: any, b: any) => b.version_number - a.version_number)[0];
      const demand = demandBreakdown(snapshots[i], 3);
      return { card, yieldPct: latest?.returns_summary?.goingInYieldPct ?? null, irr: latest?.returns_summary?.irrPct ?? null, demand };
    })
    .filter(Boolean) as Array<{ card: ReturnType<typeof toDealCard>; yieldPct: number | null; irr: number | null; demand: ReturnType<typeof demandBreakdown> }>;

  // Index of the best value in a row (ignoring blanks), or -1.
  const best = (vals: Array<number | null>, dir: "max" | "min") => {
    let idx = -1;
    vals.forEach((v, i) => {
      if (v == null) return;
      if (idx < 0 || (dir === "max" ? v > vals[idx]! : v < vals[idx]!)) idx = i;
    });
    return vals.filter((v) => v != null).length > 1 ? idx : -1;
  };
  const sameUnits = new Set(cols.map((c) => c.card.basisUnit)).size === 1;
  const rowsSpec: Array<{ label: string; vals: string[]; bestIdx: number }> = [
    { label: "Site score", vals: cols.map((c) => String(c.card.score ?? "—")), bestIdx: best(cols.map((c) => c.card.score), "max") },
    { label: "Price", vals: cols.map((c) => c.card.priceLabel), bestIdx: -1 },
    { label: "Size", vals: cols.map((c) => c.card.sizeLabel), bestIdx: -1 },
    {
      label: "Basis",
      vals: cols.map((c) => (c.card.basisValue == null ? "—" : c.card.basisLabel + c.card.basisUnit)),
      bestIdx: sameUnits ? best(cols.map((c) => c.card.basisValue), "min") : -1,
    },
    { label: "Yr-1 yield", vals: cols.map((c) => fmtPct(c.yieldPct)), bestIdx: best(cols.map((c) => c.yieldPct), "max") },
    { label: "IRR", vals: cols.map((c) => fmtPct(c.irr)), bestIdx: best(cols.map((c) => c.irr), "max") },
    { label: "Demand index (3 mi)", vals: cols.map((c) => String(c.demand.index ?? "—")), bestIdx: best(cols.map((c) => c.demand.index), "max") },
    { label: "Days in stage", vals: cols.map((c) => String(c.card.days)), bestIdx: -1 },
  ];

  return (
    <>
      <Nav active="deals" />
      <main className="bleed">
        <div className="ph">
          <div className="ph-row">
            <div className="ph-title">
              <span className="eyebrow">Acquisitions · Compare</span>
              <h1>Compare Sites</h1>
              <span className="ph-sub">{cols.length ? cols.map((c) => c.card.ref || c.card.name).join(" · ") : "Pick sites from the deals grid"}</span>
            </div>
            <div className="ph-actions">
              <a href="/deals" className="btn-inverse">
                Back to Deals
              </a>
            </div>
          </div>
        </div>
        {cols.length < 2 ? (
          <p className="empty-state">
            Tick <strong>Compare</strong> on two to four deal cards on <a href="/deals">Deals</a>, then press Compare Sites.
          </p>
        ) : (
          <div className="cmp-grid" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(240px, 1fr))`, overflowX: "auto" }}>
            {cols.map((c, i) => (
              <div key={c.card.id} className="cmp-col">
                <div className="card">
                  <div className="dcard-top">
                    <a href={`/deals/${c.card.id}`} className="dcard-name" style={{ textDecoration: "none" }}>
                      <b>{c.card.name}</b>
                      <span>{[c.card.market, c.card.typeLabel, c.card.ref].filter(Boolean).join(" · ")}</span>
                    </a>
                    <ScoreTile score={c.card.score} size="md" />
                  </div>
                  <div>
                    <Badge tone={STAGE_TONES[c.card.stage] ?? "neutral"}>{c.card.stageLabel}</Badge>
                  </div>
                  <div>
                    {rowsSpec.map((r) => (
                      <div key={r.label} className="cmp-kv">
                        <span>{r.label}</span>
                        <b className={r.bestIdx === i ? "best" : ""}>{r.vals[i]}</b>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card" style={{ gap: 6 }}>
                  <span className="overline">Site viability</span>
                  {c.card.flags.map((f) => (
                    <div key={f.key} className="flag-cell" style={{ background: hex(signal[f.state].bg), cursor: "default" }}>
                      <FlagCellBody flag={f} />
                    </div>
                  ))}
                </div>
                <div className="card" style={{ gap: 10 }}>
                  <span className="overline">Tenant demand · 3 mi</span>
                  {c.demand.index == null ? <p className="hint" style={{ margin: 0 }}>Not searched yet.</p> : <DemandBars rows={c.demand.rows} limit={6} />}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
