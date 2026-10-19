"use client";
// components/LeasesPanel.tsx
//
// An owned asset's rent roll: add, edit, mark expired or terminated, remove.
// Leases expiring inside 180 days are flagged; inside 90, in red.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEASE_TYPE_LABELS, type Lease } from "@/lib/asset-performance";

const usd = (v: number | null) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);
function daysTo(today: string, iso: string) {
  return Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
}

const EMPTY = { tenant: "", suite: "", leasedSf: "", leasedAcres: "", commencedOn: "", expiresOn: "", baseRentMonthly: "", escalationPct: "", leaseType: "nnn", options: "", notes: "" };
type Form = typeof EMPTY;
const toForm = (l: Lease): Form => ({
  tenant: l.tenant,
  suite: l.suite ?? "",
  leasedSf: l.leased_sf != null ? String(l.leased_sf) : "",
  leasedAcres: l.leased_acres != null ? String(l.leased_acres) : "",
  commencedOn: l.commenced_on ?? "",
  expiresOn: l.expires_on ?? "",
  baseRentMonthly: l.base_rent_monthly != null ? String(Math.round(l.base_rent_monthly)) : "",
  escalationPct: l.escalation_pct != null ? String(+(l.escalation_pct * 100).toFixed(3)) : "",
  leaseType: l.lease_type ?? "",
  options: l.options ?? "",
  notes: l.notes ?? "",
});

export default function LeasesPanel({ assetId, leases, today, ios }: { assetId: string; leases: Lease[]; today: string; ios: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null); // lease id or "new"
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${assetId}/leases`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed");
      setEditing(null);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const editor = (
    <form
      className="inline-add-form"
      onSubmit={(e) => {
        e.preventDefault();
        void send(editing === "new" ? "POST" : "PATCH", editing === "new" ? form : { leaseId: editing, ...form });
      }}
    >
      <div className="grid-2">
        <label>Tenant *<input value={form.tenant} onChange={set("tenant")} required /></label>
        <label>Suite / area<input value={form.suite} onChange={set("suite")} /></label>
        {ios
          ? <label>Leased acres<input value={form.leasedAcres} onChange={set("leasedAcres")} inputMode="decimal" /></label>
          : <label>Leased SF<input value={form.leasedSf} onChange={set("leasedSf")} inputMode="numeric" /></label>}
        <label>Base rent per month ($)<input value={form.baseRentMonthly} onChange={set("baseRentMonthly")} placeholder="e.g. 18,500" /></label>
        <label>Commencement<input type="date" value={form.commencedOn} onChange={set("commencedOn")} /></label>
        <label>Expiration<input type="date" value={form.expiresOn} onChange={set("expiresOn")} /></label>
        <label>Annual escalation (%)<input value={form.escalationPct} onChange={set("escalationPct")} placeholder="e.g. 3.5" /></label>
        <label>
          Lease type
          <select value={form.leaseType} onChange={set("leaseType")}>
            <option value="">—</option>
            {Object.entries(LEASE_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <label>Options (renewal, expansion, ROFR…)<input value={form.options} onChange={set("options")} /></label>
      <label>Notes<input value={form.notes} onChange={set("notes")} /></label>
      <div className="stage-actions" style={{ marginBottom: 0 }}>
        <button type="submit" disabled={busy || !form.tenant.trim()}>{busy ? "Saving…" : editing === "new" ? "Add lease" : "Save"}</button>
        <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button>
      </div>
    </form>
  );

  const sorted = [...leases].sort((a, b) => (a.status === b.status ? String(a.expires_on ?? "9999").localeCompare(String(b.expires_on ?? "9999")) : a.status === "active" ? -1 : 1));

  return (
    <section className="panel">
      <h2>Rent roll</h2>
      {sorted.length === 0 ? (
        <p className="hint">No leases yet. Add each lease to track rent, expirations and actual yield.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="summary-table">
            <thead>
              <tr><th>Tenant</th><th>{ios ? "Acres" : "SF"}</th><th>Rent / mo</th><th>Rent / yr</th><th>Term</th><th>Expires in</th><th>Type</th><th>Esc.</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {sorted.map((l) => {
                const d = l.expires_on ? daysTo(today, l.expires_on) : null;
                const live = l.status === "active";
                return (
                  <tr key={l.id} style={{ opacity: live ? 1 : 0.55 }}>
                    <td>{l.tenant}{l.suite ? <span className="muted"> · {l.suite}</span> : null}{l.options ? <><br /><span className="muted">{l.options}</span></> : null}</td>
                    <td>{ios ? (l.leased_acres ?? "—") : l.leased_sf ? Math.round(l.leased_sf).toLocaleString() : "—"}</td>
                    <td>{usd(l.base_rent_monthly)}</td>
                    <td>{l.base_rent_monthly != null ? usd(l.base_rent_monthly * 12) : "—"}</td>
                    <td className="muted">{[l.commenced_on, l.expires_on].filter(Boolean).join(" → ") || "—"}</td>
                    <td>
                      {d == null || !live ? "—" : d < 0 ? <span className="overdue">expired {-d} days ago</span> : d <= 90 ? <span className="overdue">{d} days</span> : d <= 180 ? <strong>{d} days</strong> : `${(d / 365.25).toFixed(1)} yrs`}
                    </td>
                    <td>{l.lease_type ? LEASE_TYPE_LABELS[l.lease_type] : "—"}</td>
                    <td>{l.escalation_pct != null ? `${(l.escalation_pct * 100).toFixed(1)}%` : "—"}</td>
                    <td>
                      <select
                        aria-label="Lease status"
                        value={l.status}
                        disabled={busy}
                        onChange={(e) => void send("PATCH", { leaseId: l.id, status: e.target.value })}
                      >
                        <option value="active">Active</option>
                        <option value="expired">Expired</option>
                        <option value="terminated">Terminated</option>
                      </select>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="secondary" disabled={busy} onClick={() => { setForm(toForm(l)); setEditing(l.id); }}>Edit</button>{" "}
                      <button type="button" className="secondary" disabled={busy} title="Remove" onClick={() => { if (confirm(`Remove the ${l.tenant} lease?`)) void send("DELETE", { leaseId: l.id }); }}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing ? editor : (
        <div className="stage-actions" style={{ marginBottom: 0 }}>
          <button type="button" onClick={() => { setForm(EMPTY); setEditing("new"); }}>+ Add lease</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
