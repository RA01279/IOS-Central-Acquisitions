"use client";

import { useState } from "react";
import type { ExportAssignee } from "@/lib/sourcing/export-assignment";

export default function SourcingExportAssignment({ assignees, value, onChange, loading, error, retry }: {
  assignees: ExportAssignee[]; value: string; onChange: (key: string) => void; loading: boolean; error: string | null; retry: () => void;
}) {
  const [search, setSearch] = useState("");
  const picked = assignees.find((a) => a.key === value);
  const filtered = assignees.filter((a) => a.key === value || `${a.name} ${a.firmName ?? ""} ${a.email ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 16, marginBottom: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}><strong style={{ color: "var(--navy)", fontSize: 13 }}>Assign export to broker / firm</strong>{value && <button type="button" className="link-button" onClick={() => onChange("")}>Clear assignment</button>}</div>
    <div className="grid-2" style={{ marginTop: 8 }}>
      <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>Find a broker or firm<input type="search" placeholder="Name, firm or email" value={search} onChange={(e) => setSearch(e.target.value)} style={{ font: "inherit", padding: "8px 10px", border: "1px solid var(--n300)", borderRadius: 3 }} /></label>
      <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>Export assignment<select value={value} onChange={(e) => onChange(e.target.value)} disabled={loading} style={{ font: "inherit", padding: "8px 10px", border: "1px solid var(--n300)", borderRadius: 3, background: "white" }}>
        <option value="">Unassigned</option>
        {value && !picked && <option value={value}>Previous assignment unavailable — choose again</option>}
        <optgroup label="Brokers">{filtered.filter((a) => a.kind === "broker").map((a) => <option key={a.key} value={a.key}>{a.name}{a.firmName ? ` — ${a.firmName}` : " — no firm listed"}{a.email ? ` (${a.email})` : ""}</option>)}</optgroup>
        <optgroup label="Firms">{filtered.filter((a) => a.kind === "firm").map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</optgroup>
      </select></label>
    </div>
    {loading ? <p role="status" className="hint">Loading broker directory…</p> : error ? <p role="alert" className="error">{error} <button type="button" className="link-button" onClick={retry}>Retry</button></p> : <p className="hint" style={{ marginBottom: 0 }}>{picked ? `Assigned to ${picked.name}${picked.kind === "broker" && picked.firmName ? ` · ${picked.firmName}` : ""}. Applies to every property in this export.` : "Optional. Choose a broker or firm to include the assignment in the workbook."}{" "}This labels the export; it does not send it or change deal assignments.</p>}
    {!loading && !error && !filtered.length && <p className="hint">No matches. Add the broker or firm in <a href="/contacts" target="_blank" rel="noopener noreferrer">Contacts</a>, then <button type="button" className="link-button" onClick={retry}>reload the directory</button>.</p>}
  </div>;
}
