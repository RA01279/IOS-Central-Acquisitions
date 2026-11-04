import { decisionReport } from "@/lib/decision-report";
import { Badge } from "@/components/ui";

const usd = (v: number | null) => (v == null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v).toLocaleString("en-US")}`);
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);
// Stored as ISO timestamps or YYYY-MM-DD; shown in Central time like the rest of the tab.
const day = (s: string | null) => {
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : s);
  return Number.isNaN(+d) ? s : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
};
const orNone = (v: React.ReactNode, empty = "Not recorded") => (v ? v : <span className="fin-muted">{empty}</span>);

/** Read-only snapshot of the decision record and where its numbers come from. Collapsed by default. */
export default function DecisionContext({ deal }: { deal: any }) {
  const d = decisionReport(deal);
  const conflicts = d.conflicts ? d.conflicts.split("; ").filter(Boolean) : [];
  return (
    <details className="panel fin-collapse">
      <summary>
        <h2>Decision snapshot</h2>
        {conflicts.length > 0 ? <Badge tone="warning">{conflicts.length} to reconcile</Badge> : <Badge tone="success">No conflicts</Badge>}
        <span className="fin-collapse-meta">{d.status ?? "Status unknown"} · {d.owner ?? "Unassigned"}</span>
      </summary>

      <div className="fin-stats">
        <div><div className="label">Asking</div><div className="value">{usd(d.askingPrice)}</div><div className="sub">{[day(d.askingDate), d.askingSource].filter(Boolean).join(" · ") || "Source unknown"}</div></div>
        <div><div className="label">Model price</div><div className="value">{usd(d.modelPrice)}</div><div className="sub">{d.modelVersion != null ? `Workbook v${d.modelVersion}` : "No workbook"}</div></div>
        <div><div className="label">Latest bid</div><div className="value">{usd(d.latestBid)}</div><div className="sub">{day(d.bidDate) ?? "No offers logged"}</div></div>
        <div><div className="label">Workbook IRR</div><div className="value">{pct(d.modelIrr)}</div><div className="sub">{d.modelIrr == null && d.modelVersion != null ? "Identity unconfirmed" : "Cached workbook result"}</div></div>
        <div><div className="label">Screening IRR</div><div className="value">{pct(d.screeningIrr)}</div><div className="sub">{day(d.screenDate) ?? "No saved screening run"}</div></div>
        <div><div className="label">Current base rent</div><div className="value">{d.currentBaseRent === 0 ? "$0" : usd(d.currentBaseRent)}</div><div className="sub">{d.currentBaseRent === 0 ? "Vacant" : d.currentBaseRent == null ? "Needs source verification" : "Verified in place"}</div></div>
      </div>

      {conflicts.length > 0 ? (
        <div className="warning">
          <p>Reconcile before relying on these numbers:</p>
          <ul>{conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      ) : (
        <p className="hint">No conflicts between the workbook, screening run, comps and recorded income. This is not an investment approval.</p>
      )}

      <dl className="fin-dl">
        <dt>Pursuit rationale</dt><dd>{orNone(d.rationale)}</dd>
        <dt>Vehicle / partner</dt><dd>{orNone(d.vehicle)}</dd>
        <dt>Downside drivers</dt><dd>{orNone(d.downside)}</dd>
        <dt>Requested next action</dt><dd>{orNone(d.nextAction)}</dd>
        <dt>Follow-up</dt><dd>{orNone(day(d.followUpOn), "Unassigned")}</dd>
        <dt>Offer deadline</dt><dd>{d.deadline ? <>{day(d.deadline)}{d.deadlineSource && <span className="fin-muted"> · {d.deadlineSource}</span>}</> : orNone(null, "Unknown")}</dd>
        <dt>Income</dt><dd>{d.income}{d.incomeEffectiveDate && <span className="fin-muted"> · effective {day(d.incomeEffectiveDate)}</span>}</dd>
        <dt>Comp evidence</dt><dd>{d.compReview}</dd>
      </dl>

      <details className="fin-details">
        <summary>How the returns and assumptions reconcile</summary>
        <p className="hint">{d.bridge}</p>
        {d.assumptions && <p className="hint">{d.assumptions}</p>}
        <p className="hint">Returns: {d.returnSource}</p>
      </details>
      <p className="hint"><a href={`/deals/${deal.id}/diligence`}>Open original documents and workbook attachments</a></p>
    </details>
  );
}
