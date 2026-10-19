"use client";
// components/ContactSplitter.tsx
//
// Contacts page clean-up: records that hold a whole broker team ("Stephen
// Bailey / Dustin Volz (Newmark)") or contact details typed into the name.
// Each shows the proposed firm and people (lib/contact-split.ts), editable;
// Split turns it into one contact per person, reusing people already in
// Hopper and linking each to the record's deals.

import { useState } from "react";
import { useRouter } from "next/navigation";

export type SplitProposal = {
  id: string;
  raw: string;
  deals: number;
  firm: { companyId: string | null; name: string } | null;
  people: { name: string; email: string; phone: string }[];
};

export default function ContactSplitter({ proposals, companies }: { proposals: SplitProposal[]; companies: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(proposals);
  const [firmPick, setFirmPick] = useState<Record<string, string>>(() =>
    Object.fromEntries(proposals.map((p) => [p.id, p.firm ? (p.firm.companyId ? `id:${p.firm.companyId}` : `new:${p.firm.name}`) : ""]))
  );
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!proposals.length) return null;

  const setPerson = (id: string, i: number, patch: Partial<SplitProposal["people"][number]>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, people: r.people.map((p, j) => (j === i ? { ...p, ...patch } : p)) } : r)));

  async function split(r: SplitProposal) {
    setBusy(r.id);
    setError(null);
    const pick = firmPick[r.id] ?? "";
    const firm = pick.startsWith("id:") ? { companyId: pick.slice(3) } : pick.startsWith("new:") ? { name: pick.slice(4) } : null;
    try {
      const res = await fetch(`/api/contacts/${r.id}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firm, people: r.people.filter((p) => p.name.trim()) }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error ?? "Split failed");
      setDone((d) => ({ ...d, [r.id]: b.people.map((p: any) => `${p.name} (${p.how})`).join(", ") }));
    } catch (e: any) {
      setError(`${r.raw.slice(0, 60)}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  const left = rows.filter((r) => !done[r.id]).length;
  return (
    <section className="panel">
      <div className="card-head">
        <h2 style={{ margin: 0 }}>Contacts holding several people ({left})</h2>
        <button type="button" className="secondary" onClick={() => { if (open) router.refresh(); setOpen(!open); }}>{open ? "Done" : "Review"}</button>
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        Broker teams entered as one contact, or with emails and phones typed into the name. Split each into one contact per person:
        people already in Hopper are reused, each is linked to the record&apos;s deals, and the record&apos;s notes and tasks stay with
        the first person.
      </p>
      {open && rows.map((r) => (
        <div key={r.id} className="inline-add-form" style={{ width: "100%", opacity: done[r.id] ? 0.55 : 1 }}>
          <p style={{ margin: 0 }}><span className="muted">Now:</span> <a href={`/contacts/${r.id}`}>{r.raw}</a> <span className="muted">· {r.deals} deal{r.deals === 1 ? "" : "s"}</span></p>
          {done[r.id] ? (
            <p className="hint" style={{ margin: 0 }}>✓ {done[r.id]}</p>
          ) : (
            <>
              <label style={{ maxWidth: 360 }}>
                Firm
                <select value={firmPick[r.id] ?? ""} onChange={(e) => setFirmPick((f) => ({ ...f, [r.id]: e.target.value }))}>
                  <option value="">None / keep current</option>
                  {r.firm && !r.firm.companyId && <option value={`new:${r.firm.name}`}>New firm: {r.firm.name}</option>}
                  {companies.map((c) => <option key={c.id} value={`id:${c.id}`}>{c.name}</option>)}
                </select>
              </label>
              <table className="summary-table">
                <thead><tr><th>Person</th><th>Email</th><th>Phone</th><th></th></tr></thead>
                <tbody>
                  {r.people.map((p, i) => (
                    <tr key={i}>
                      <td><input value={p.name} onChange={(e) => setPerson(r.id, i, { name: e.target.value })} />{i === 0 ? <span className="muted"> (keeps this record)</span> : null}</td>
                      <td><input value={p.email} onChange={(e) => setPerson(r.id, i, { email: e.target.value })} placeholder="—" /></td>
                      <td><input value={p.phone} onChange={(e) => setPerson(r.id, i, { phone: e.target.value })} placeholder="—" style={{ width: 130 }} /></td>
                      <td>{r.people.length > 1 && <button type="button" className="secondary" title="Remove" onClick={() => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, people: x.people.filter((_, j) => j !== i) } : x)))}>×</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="stage-actions" style={{ marginBottom: 0 }}>
                <button type="button" className="secondary" onClick={() => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, people: [...x.people, { name: "", email: "", phone: "" }] } : x)))}>+ Person</button>
                <button type="button" disabled={busy !== null || !r.people.some((p) => p.name.trim())} onClick={() => void split(r)}>
                  {busy === r.id ? "Splitting…" : `Split into ${r.people.filter((p) => p.name.trim()).length}`}
                </button>
              </div>
            </>
          )}
        </div>
      ))}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
