"use client";
// components/DealContactsPanel.tsx
//
// The people on a deal: lists linked contacts with their roles, links new
// ones, unlinks. Shared by the acquisitions and leasing detail pages -- the
// server page passes in the deal-type-appropriate role options and the
// contact list for the dropdown.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type LinkedContact = {
  id: string; // deal_contacts link id
  role: string;
  contacts: {
    id: string;
    name: string;
    email: string | null;
    companies: { name: string } | null;
  } | null;
};

export default function DealContactsPanel({
  dealId,
  links,
  contacts,
  roleOptions,
  roleLabels,
}: {
  dealId: string;
  links: LinkedContact[];
  contacts: { id: string; name: string }[];
  roleOptions: string[];
  roleLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/deals/${dealId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: form.get("contactId"), role: form.get("role") }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to link contact");
      setAdding(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(linkId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/contacts`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to remove");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Contacts</h2>

      {links.length === 0 ? (
        <p className="muted">No contacts on this deal yet.</p>
      ) : (
        <ul className="doc-list">
          {links.map((l) => (
            <li key={l.id}>
              <span className="doc-type">{roleLabels[l.role] ?? l.role}</span>
              {l.contacts ? (
                <>
                  <Link href={`/contacts/${l.contacts.id}`}>{l.contacts.name}</Link>
                  {l.contacts.companies?.name && (
                    <span className="muted"> · {l.contacts.companies.name}</span>
                  )}
                  {l.contacts.email && <span className="muted"> · {l.contacts.email}</span>}
                </>
              ) : (
                <span className="muted">(deleted contact)</span>
              )}
              <button
                type="button"
                className="link-remove"
                onClick={() => handleRemove(l.id)}
                disabled={busy}
                title="Remove from deal"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {!adding ? (
        <div className="stage-actions" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className="secondary" onClick={() => setAdding(true)}>
            + Link contact
          </button>
        </div>
      ) : (
        <form onSubmit={handleAdd} className="inline-add-form">
          <div className="grid-2">
            <label>
              Contact
              <select name="contactId" required defaultValue="">
                <option value="" disabled>
                  Select…
                </option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Role on this deal
              <select name="role" required defaultValue={roleOptions[0]}>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {roleLabels[r] ?? r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="hint">
            Not in the list? Add them on the <Link href="/contacts">Contacts</Link> page first.
          </p>
          <div className="stage-actions" style={{ marginBottom: 0 }}>
            <button type="submit" disabled={busy}>
              {busy ? "Linking…" : "Link contact"}
            </button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
