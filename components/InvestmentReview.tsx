"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { incomePosition, latestVersion, modelIdentity } from "@/lib/investment-review";
import { Badge, type BadgeTone } from "@/components/ui";
import DealImport from "./DealImport";

const stamp = (s: string | null | undefined) => {
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(+d) ? s : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
};
const IDENTITY: Record<string, { tone: BadgeTone; label: string }> = {
  matched: { tone: "success", label: "Model matches deal" },
  resolved: { tone: "success", label: "Model accepted" },
  unresolved: { tone: "warning", label: "Model identity to review" },
  wrong_upload: { tone: "danger", label: "Marked wrong upload" },
  missing: { tone: "neutral", label: "No model" },
};
const STATUS_SUGGESTIONS = ["Screening", "Pursuing", "Offer out", "Negotiating LOI", "Under contract", "On hold", "Passed"];

/**
 * The editable evidence and decision record: which model the reported returns
 * come from, what income is really in place, and where the pursuit stands.
 * Collapsed by default. Saves the same fields as before; layout only.
 */
export default function InvestmentReview({ deal }: { deal: any }) {
  const router = useRouter();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(""), [dirty, setDirty] = useState(false);
  const [deadlineDraft, setDeadlineDraft] = useState<any>(null);
  const v = latestVersion(deal), identity = modelIdentity(deal), income = incomePosition(deal), r = deal.investment_review ?? {};
  const [incomeStatus, setIncomeStatus] = useState<string>(r.incomeStatus ?? "unknown");
  const [resolving, setResolving] = useState(identity.state === "unresolved");
  const id = IDENTITY[identity.state] ?? IDENTITY.missing;
  const needsSource = incomeStatus !== "unknown";

  async function send(body: any, done: string): Promise<boolean> {
    setBusy(true); setError(""); setSaved("");
    try {
      const response = await fetch(`/api/deals/${deal.id}/investment-review`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, expectedReviewAt: r.updatedAt ?? null, expectedResolutionAt: v?.returns_summary?.identityResolution?.at ?? null }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setSaved(done); setDirty(false); router.refresh();
      return true;
    } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }

  const text = (name: string, label: string, opts: { required?: boolean; long?: boolean; full?: boolean; placeholder?: string; value?: string | null } = {}) => (
    <label className={opts.full ? "fin-span-3" : opts.long ? "fin-span-2" : undefined}>{label}
      {opts.long
        ? <textarea name={name} rows={2} maxLength={2000} required={opts.required} placeholder={opts.placeholder} defaultValue={opts.value ?? r[name] ?? ""} />
        : <input name={name} maxLength={2000} required={opts.required} placeholder={opts.placeholder} defaultValue={opts.value ?? r[name] ?? ""} />}
    </label>
  );
  const date = (name: string, label: string, value?: string | null, required?: boolean) => (
    <label>{label}<input name={name} type="date" required={required} defaultValue={value ?? r[name] ?? ""} /></label>
  );

  return (
    <details id="investment-review" className="panel fin-collapse">
      <summary>
        <h2>Evidence and decision</h2>
        <Badge tone={id.tone}>{id.label}</Badge>
        <span className="fin-collapse-meta">{income.label}{r.updatedAt ? ` · updated ${stamp(r.updatedAt)}${r.updatedBy ? ` by ${String(r.updatedBy).split("@")[0]}` : ""}` : ""}</span>
      </summary>

      <section className="fin-section">
        <h3>Model source</h3>
        {v ? (
          <p className="fin-lede">
            Returns come from <strong>workbook v{v.version_number}</strong>{v.created_by ? ` · ${String(v.created_by).split("@")[0]}` : ""} · {stamp(v.created_at)} ·{" "}
            {r.selectedModelId ? "explicitly selected" : "latest upload (not yet approved)"}
          </p>
        ) : <p className="hint">No workbook uploaded yet.</p>}
        {identity.issues.length > 0 && <div className="warning"><ul>{identity.issues.map((x) => <li key={x}>{x}</li>)}</ul></div>}
        {identity.resolution && <p className="hint">Reviewed by {identity.resolution.actor} on {stamp(identity.resolution.at)}: {identity.resolution.reason}</p>}
        {v && !resolving && (
          <button type="button" className="link-button fin-link-sm" onClick={() => setResolving(true)}>
            {identity.state === "matched" ? "Mark this model as a wrong upload…" : "Record a different resolution…"}
          </button>
        )}
        {v && resolving && (
          <form className="fin-form-grid fin-subform" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void send({ action: "resolve_model", versionId: v.id, outcome: f.get("outcome"), reason: f.get("reason") }, "Resolution recorded.").then((ok) => ok && setResolving(false)); }}>
            <label>Decision
              <select name="outcome" defaultValue={identity.state === "matched" ? "wrong_upload" : "accepted"}>
                <option value="accepted">Accept: right model for this property</option>
                <option value="wrong_upload">Wrong upload: exclude its returns</option>
              </select>
            </label>
            <label className="fin-span-2">Evidence and explanation
              <textarea name="reason" required minLength={10} maxLength={2000} rows={2} placeholder="e.g. Template cells carry the prior deal's address; rent roll and site plan match this property." />
            </label>
            <div className="fin-form-actions fin-span-3">
              <button disabled={busy}>Record resolution</button>
              <button type="button" className="secondary" onClick={() => setResolving(false)}>Cancel</button>
            </div>
          </form>
        )}
      </section>

      {/* Re-keyed on each save so fields show what was stored; the panel itself stays open. */}
      <form key={`${r.updatedAt ?? ""}:${JSON.stringify(deadlineDraft)}`} onChange={() => { setDirty(true); setSaved(""); }}
        onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget), review = Object.fromEntries(f); delete review.followUpOn; delete review.callForOffersOn; send({ review, followUpOn: f.get("followUpOn"), callForOffersOn: f.get("callForOffersOn") }, "Saved."); }}>

        <section className="fin-section">
          <h3>Model for reported returns</h3>
          <div className="fin-form-grid">
            <label className="fin-span-2">Version
              <select name="selectedModelId" defaultValue={r.selectedModelId ?? ""}>
                <option value="">Latest upload (automatic; not approved)</option>
                {[...(deal.uw_versions ?? [])].sort((a: any, b: any) => b.version_number - a.version_number)
                  .map((m: any) => <option value={m.id} key={m.id}>v{m.version_number} · {stamp(m.created_at)}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="fin-section">
          <h3>Income</h3>
          <div className="fin-form-grid">
            <label>Status
              <select name="incomeStatus" value={incomeStatus} onChange={(e) => setIncomeStatus(e.target.value)}>
                <option value="unknown">Unknown / unverified</option>
                <option value="proposed">Proposed lease</option>
                <option value="executed">Executed, not yet in place</option>
                <option value="in_place">In place</option>
              </select>
            </label>
            {date("incomeSourceDate", "Source date", null, needsSource)}
            {date("incomeEffectiveDate", "Commencement / effective", null, incomeStatus === "in_place")}
            {text("incomeSource", "Source / lease reference", { long: true, required: needsSource, placeholder: needsSource ? "Required: executed lease, rent roll or estoppel" : "e.g. Executed lease dated 3/1/2026, §4" })}
          </div>
          <p className="hint">Proposed income belongs in a screening case, not current rent. Vacant sites stay vacant in current-income reporting.</p>
        </section>

        <section className="fin-section">
          <h3>Decision</h3>
          <div className="fin-form-grid">
            <label>Status
              <input name="decisionStatus" list="decision-status-options" maxLength={2000} defaultValue={r.decisionStatus ?? ""} placeholder="e.g. Pursuing" />
              <datalist id="decision-status-options">{STATUS_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
            </label>
            {text("vehicle", "Vehicle / partner fit")}
            {date("followUpOn", "Next follow-up", deal.follow_up_on)}
            {text("rationale", "Pursuit rationale", { long: true })}
            <label>Owner<input value={deal.assigned_analyst ?? "Unassigned"} disabled readOnly /></label>
            {text("downside", "Supported downside drivers", { long: true, full: true })}
            {text("nextAction", "Requested next action", { long: true, full: true })}
          </div>
        </section>

        <section className="fin-section">
          <h3>Pricing and deadline</h3>
          <div className="fin-form-grid">
            {text("askingSource", "Asking guidance source", { long: true, placeholder: "e.g. Broker email, 10/14" })}
            {date("askingDate", "Asking guidance date")}
            {date("callForOffersOn", "Call for offers", deadlineDraft?.callForOffersOn ?? deal.call_for_offers_on)}
            {date("deadlineSourceDate", "Deadline source date", deadlineDraft?.deadlineSourceDate)}
            {text("deadlineSource", "Deadline source quote / reference", { value: deadlineDraft?.deadlineSourceQuote })}
          </div>
          <details className="fin-details">
            <summary>Fill the deadline from a broker email or document</summary>
            <DealImport onImported={(draft) => {
              const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
              if (norm(draft.fields.address ?? "") !== norm(deal.properties?.address ?? "")) { setError("That source is for a different address. Nothing was filled in; update the fields by hand if it applies."); return; }
              setDeadlineDraft(draft.fields); setDirty(true);
            }} />
            {deadlineDraft && <p className="hint">Deadline fields filled from the source. Check them, then save. No new deal is created.</p>}
          </details>
        </section>

        <div className="fin-form-actions fin-save-bar">
          <button disabled={busy || !dirty}>{busy ? "Saving…" : "Save evidence and decision"}</button>
          {dirty && !busy && <span className="fin-muted">Unsaved changes</span>}
          {saved && <span className="fin-saved">{saved}</span>}
          {error && <span role="alert" className="error">{error}</span>}
        </div>
      </form>
    </details>
  );
}
