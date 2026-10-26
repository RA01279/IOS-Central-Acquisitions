"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { SOURCING_PROFILES } from "@/lib/sourcing/profiles";

export default function SourcingProfilePicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", escape); };
  }, [open]);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
  const matches = SOURCING_PROFILES.filter((p) => `${p.label} ${p.keywords.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div style={{ marginBottom: 20 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
      <div className="fpill-wrap" ref={root}>
        <button type="button" ref={trigger} className="fpill" aria-expanded={open} aria-controls="sourcing-profile-options" onClick={() => setOpen(!open)}>
          <span className="fpill-label">Occupier profiles:</span> {selected.length === SOURCING_PROFILES.length ? "All 10 (default)" : selected.length ? `${selected.length} selected` : "Choose profiles"}<ChevronDown size={14} />
        </button>
        {open && <div className="fmenu" id="sourcing-profile-options" style={{ width: "min(360px, calc(100vw - 48px))" }}>
          <label style={{ display: "flex", flexDirection: "row", alignItems: "center", margin: "2px 2px 8px", gap: 8 }}><Search size={15} aria-hidden="true" /><input ref={search} aria-label="Search profiles" type="search" placeholder="Search business type or keyword" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: "100%", minWidth: 0 }} /></label>
          <div className="fmenu-list">
            {matches.map((p) => <label key={p.id} className="fmenu-item" title={`Google keywords: ${p.keywords.join("; ")}`} style={{ flexDirection: "row", margin: 0, cursor: "pointer" }}><input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} style={{ accentColor: "var(--brand)", width: 16, height: 16 }} />{p.label}</label>)}
            {!matches.length && <p className="hint" style={{ padding: 8 }}>No matching profiles.</p>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <button type="button" className="fmenu-clear" onClick={() => onChange(SOURCING_PROFILES.map((p) => p.id))}>Select all</button>
            <button type="button" className="fmenu-clear" onClick={() => onChange([])}>Clear profiles</button>
            <button type="button" className="fmenu-clear" onClick={() => { setOpen(false); trigger.current?.focus(); }}>Done</button>
          </div>
        </div>}
      </div>
      <span className="hint">Matches any selected profile within your search area.</span>
      {selected.length > 0 && <button type="button" className="link-button" onClick={() => onChange([])}>Clear</button>}
    </div>
    <div aria-label="Selected profiles" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {SOURCING_PROFILES.filter((p) => selected.includes(p.id)).map((p) => <button type="button" key={p.id} className="fchip" aria-label={`Remove ${p.label}`} onClick={() => toggle(p.id)}>{p.label}<X size={12} aria-hidden="true" /></button>)}
    </div>
    <details style={{ marginTop: 10 }}><summary className="hint" style={{ cursor: "pointer" }}>Google search definitions</summary><p className="hint">Profiles are search signals, not verified land use. Each selected profile runs all its keywords, with existing non-yard screening.</p><ul className="hint">{SOURCING_PROFILES.map((p) => <li key={p.id}><strong>{p.label}:</strong> {p.keywords.join("; ")}</li>)}</ul></details>
  </div>;
}
