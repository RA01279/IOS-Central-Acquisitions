// app/deals/[id]/underwriting/page.tsx
//
// Underwriting tab, slice 1: the Hopper engine run on SAMPLE inputs (the
// 3879 Rendon Rd workbook), read-only. Nothing here reads or writes this
// deal's data -- the banner says so. Hidden behind NEXT_PUBLIC_UW_ENGINE_TAB=1;
// without it the route 404s and the tab is not shown.

import { notFound } from "next/navigation";
import { KpiCard } from "@/components/ui";
import { rendon } from "@/lib/uw/fixtures/rendon";
import { buildUwView, fmtPct, fmtRatio, fmtUsd, type UwCashFlowRow, type UwSensitivityGrid } from "@/lib/uw/view-model";

export const metadata = { title: "Underwriting" };

const CENTER_CELL: React.CSSProperties = { fontWeight: 600, background: "var(--warn-bg)", color: "var(--warn-text)" };

function cell(v: number | null, format: UwCashFlowRow["format"]) {
  if (v === null) return "";
  if (format === "ratio") return fmtRatio(v);
  if (format === "pct") return fmtPct(v, 1);
  return fmtUsd(v);
}

function SensitivityTable({ grid }: { grid: UwSensitivityGrid }) {
  return (
    <div className="card" style={{ gap: 8 }}>
      <span className="overline">{grid.title}</span>
      <div className="table-scroll">
        <table className="summary-table">
          <thead>
            <tr>
              <th scope="col">Growth ↓ · Exit cap →</th>
              {grid.exitCapLabels.map((c) => (
                <th key={c} scope="col">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.cells.map((row, i) => (
              <tr key={grid.growthLabels[i]}>
                <th scope="row">{grid.growthLabels[i]}</th>
                {row.map((c, j) => (
                  <td key={j} style={c.center ? CENTER_CELL : undefined} title={c.center ? "Headline case" : undefined}>
                    {c.display}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function UnderwritingPage() {
  if (process.env.NEXT_PUBLIC_UW_ENGINE_TAB !== "1") notFound();

  const view = buildUwView(rendon);

  return (
    <div className="ws-body">
      <div className="warning" role="note" style={{ marginTop: 0 }}>
        <strong>Hopper engine (draft) - SAMPLE INPUTS: {view.property}.</strong> These are not this deal&apos;s numbers.
      </div>

      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {view.kpis.map((k) => (
          <KpiCard key={k.key} label={k.label} value={k.display} sub={k.sub} />
        ))}
      </div>

      {view.warnings.length > 0 && (
        <div className="warning">
          <ul style={{ margin: 0 }}>
            {view.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="panel">
        <h2>Annual cash flow</h2>
        <p className="hint">
          {view.scenario} scenario · {view.hold}-year hold · Year 0 is closing.
        </p>
        <div className="table-scroll">
          <table className="summary-table">
            <thead>
              <tr>
                <th scope="col">$</th>
                {view.years.map((y) => (
                  <th key={y} scope="col">Yr {y}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.cashFlow.map((row) => (
                <tr key={row.label} className={row.emphasis ? "summary-total" : undefined}>
                  <th scope="row">{row.label}</th>
                  {row.values.map((v, i) => (
                    <td key={i}>{cell(v, row.format)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Sensitivities</h2>
        <p className="hint">
          Exit cap across, market rent growth down (applies only to tenants with no stated bump). The highlighted cell is the headline case.
        </p>
        <div className="stack" style={{ gap: 14 }}>
          <SensitivityTable grid={view.sensitivities[0]} />
          <SensitivityTable grid={view.sensitivities[1]} />
        </div>
      </section>

      <section className="panel">
        <h2>Model notes</h2>
        <ul className="hint" style={{ paddingLeft: 18 }}>
          {view.modelNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
