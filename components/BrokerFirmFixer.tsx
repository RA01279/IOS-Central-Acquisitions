"use client";
// components/BrokerFirmFixer.tsx
//
// On the broker scorecard: brokers with no firm, each with a suggested
// brokerage (lib/firm-guess.ts). Confirm the suggestion, pick another firm,
// or type a new one; saving links the contact to the firm (creating it when
// new), so its deals and comps roll up under Firms.

import { useState } from "react";
import { useRouter } from "next/navigation";

export type FirmlessBroker = {
  id: string;
  name: string;
  email: string | null;
  deals: number;
  guess: { companyId: string | null; name: string; why: string } | null;
};

export default function BrokerFirmFixer({ brokers, companies }: { brokers: FirmlessBroker[]; companies: { id: string; name: string }[] }) {
  const router = useRouter();
  const [choice, setChoice] = useState<Record<string, string>>(() =>
    Object.fromEntries(brokers.map((b) => [b.id, b.guess ? (b.guess.companyId ? `id:${b.guess.companyId}` : `new:${b.guess.name}`) : ""]))
  );
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function save(b: FirmlessBroker) {
    const c = choice[b.id] ?? "";
    const body: Record<string, unknown> = { contactType: "broker" };
    if (c.startsWith("id:")) body.companyId = c.slice(3);
    else if (c === "type") body.newCompanyName = (typed[b.id] ?? "").trim();
    else if (c.startsWith("new:")) body.newCompanyName = c.slice(4);
    if (!body.companyId && !body.newCompanyName) return;
    setBusy(b.id);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed");
      setSaved((s) => ({ ...s, [b.id]: body.companyId ? companies.find((x) => x.id === body.companyId)?.name ?? "saved" : String(body.newCompanyName) }));
    } catch (e: any) {
      setError(`${b.name}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  if (!brokers.length) return null;
  const left = brokers.filter((b) => !saved[b.id]);
  const suggested = left.filter((b) => b.guess).length;

  return (
    <section className="panel">
      <div className="card-head">
        <h2 style={{ margin: 0 }}>Brokers with no firm ({left.length})</h2>
        <button type="button" className="secondary" onClick={() => { if (open) router.refresh(); setOpen(!open); }}>
          {open ? "Done" : "Review"}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        Their deals and comps don&apos;t count toward any firm until they&apos;re linked to one. {suggested} have a suggestion from their
        name or email; confirm it, pick another firm, or type a new one.
      </p>
      {open && (
        <div style={{ overflowX: "auto" }}>
          <table className="summary-table">
            <thead><tr><th>Broker</th><th>Deals</th><th>Firm</th><th></th></tr></thead>
            <tbody>
              {brokers.map((b) => (
                <tr key={b.id} style={{ opacity: saved[b.id] ? 0.55 : 1 }}>
                  <td>
                    <a href={`/contacts/${b.id}`}>{b.name}</a>
                    {b.email ? <span className="muted"> · {b.email}</span> : null}
                    {b.guess ? <><br /><span className="muted">Suggested: {b.guess.name} ({b.guess.companyId ? "existing firm" : "new firm"}, {b.guess.why})</span></> : null}
                  </td>
                  <td>{b.deals}</td>
                  <td>
                    {saved[b.id] ? (
                      <span>✓ {saved[b.id]}</span>
                    ) : (
                      <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                        <select value={choice[b.id] ?? ""} onChange={(e) => setChoice((c) => ({ ...c, [b.id]: e.target.value }))} aria-label={`Firm for ${b.name}`}>
                          <option value="">Choose…</option>
                          {b.guess && !b.guess.companyId && <option value={`new:${b.guess.name}`}>New firm: {b.guess.name}</option>}
                          {companies.map((c) => <option key={c.id} value={`id:${c.id}`}>{c.name}</option>)}
                          <option value="type">Another new firm…</option>
                        </select>
                        {choice[b.id] === "type" && (
                          <input placeholder="Firm name" value={typed[b.id] ?? ""} onChange={(e) => setTyped((t) => ({ ...t, [b.id]: e.target.value }))} />
                        )}
                      </span>
                    )}
                  </td>
                  <td>
                    {!saved[b.id] && (
                      <button type="button" disabled={busy !== null || !choice[b.id] || (choice[b.id] === "type" && !(typed[b.id] ?? "").trim())} onClick={() => void save(b)}>
                        {busy === b.id ? "Saving…" : "Save"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
