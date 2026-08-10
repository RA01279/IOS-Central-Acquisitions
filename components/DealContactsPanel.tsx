"use client";
// components/DealContactsPanel.tsx
//
// The people on a deal: lists linked contacts with their roles, links new
// ones, unlinks. Linking uses a type-ahead search over the contact book
// (name or company) instead of a dropdown -- and can create a brand-new
// contact from the typed name, auto-classified from the role being assigned.

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

type PickableContact = { id: string; name: string; company: string | null };

// Role being assigned implies the classification for a newly created contact.
const ROLE_TO_TYPE: Record<string, string | null> = {
  seller: null, // owner-user vs institutional: classified by hand later
  buyer: null,
  seller_broker: "broker",
  buyer_broker: "broker",
  tenant: "tenant",
  landlord: "institutional_owner",
  tenant_broker: "broker",
  listing_broker: "broker",
  other: null,
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
  contacts: PickableContact[];
  roleOptions: string[];
  roleLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PickableContact | null>(null);
  const [role, setRole] = useState(roleOptions[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const matches =
    q.length > 0 && !picked
      ? contacts
          .filter(
            (c) =>
              c.name.toLowerCase().includes(q) ||
              (c.company ?? "").toLowerCase().includes(q)
          )
          .slice(0, 8)
      : [];
  const exactMatch = contacts.some((c) => c.name.toLowerCase() === q);

  function reset() {
    setAdding(false);
    setQuery("");
    setPicked(null);
    setError(null);
  }

  async function linkContact(contactId: string) {
    const res = await fetch(`/api/deals/${dealId}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, role }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to link contact");
  }

  async function handleLink() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await linkContact(picked.id);
      reset();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateAndLink() {
    const name = query.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, contactType: ROLE_TO_TYPE[role] ?? undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create contact");
      const { contact } = await res.json();
      await linkContact(contact.id);
      reset();
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
                onClick={async () => {
                  setBusy(true);
                  try {
                    await fetch(`/api/deals/${dealId}/contacts`, {
                      method: "DELETE",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ linkId: l.id }),
                    });
                    router.refresh();
                  } finally {
                    setBusy(false);
                  }
                }}
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
        <div className="inline-add-form">
          <div className="grid-2">
            <label>
              Who
              {picked ? (
                <span className="picked-contact">
                  <strong>{picked.name}</strong>
                  {picked.company ? <span className="muted"> · {picked.company}</span> : null}
                  <button type="button" className="link-remove" onClick={() => setPicked(null)}>
                    ×
                  </button>
                </span>
              ) : (
                <span className="combo">
                  <input
                    autoFocus
                    placeholder="Start typing a name or firm…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (matches.length > 0) setPicked(matches[0]);
                      }
                    }}
                  />
                  {q.length > 0 && (
                    <span className="combo-list">
                      {matches.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="combo-item"
                          onClick={() => setPicked(m)}
                        >
                          <strong>{m.name}</strong>
                          {m.company ? <span className="muted"> · {m.company}</span> : null}
                        </button>
                      ))}
                      {!exactMatch && (
                        <button
                          type="button"
                          className="combo-item combo-create"
                          onClick={handleCreateAndLink}
                          disabled={busy}
                        >
                          + Create “{query.trim()}” as a new {roleLabels[role]?.toLowerCase() ?? "contact"}
                        </button>
                      )}
                      {matches.length === 0 && exactMatch === false && q.length === 0 && (
                        <span className="combo-item muted">Keep typing…</span>
                      )}
                    </span>
                  )}
                </span>
              )}
            </label>
            <label>
              Role on this deal
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {roleLabels[r] ?? r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="stage-actions" style={{ marginBottom: 0 }}>
            <button type="button" onClick={handleLink} disabled={busy || !picked}>
              {busy ? "Linking…" : "Link contact"}
            </button>
            <button type="button" className="secondary" onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
