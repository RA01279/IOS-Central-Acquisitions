"use client";
// components/ContactEditForm.tsx
//
// Edit every field of an existing contact, including classification and
// company (with inline new-company creation). Also handles delete.

import { useState } from "react";
import { useRouter } from "next/navigation";

const NEW_COMPANY = "__new__";

export default function ContactEditForm({
  contact,
  companies,
}: {
  contact: {
    id: string;
    name: string;
    contact_type: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    company_id: string | null;
  };
  companies: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [companyChoice, setCompanyChoice] = useState(contact.company_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          contactType: form.get("contactType") || null,
          title: form.get("title"),
          email: form.get("email"),
          phone: form.get("phone"),
          address: form.get("address"),
          companyId: companyChoice && companyChoice !== NEW_COMPANY ? companyChoice : undefined,
          newCompanyName: companyChoice === NEW_COMPANY ? form.get("newCompanyName") : undefined,
          newCompanyType: companyChoice === NEW_COMPANY ? form.get("newCompanyType") : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete ${contact.name} permanently? Their deal links go too.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Delete failed");
      window.location.assign("/contacts");
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="secondary" onClick={() => setOpen(true)}>
        Edit contact
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="inline-add-form">
      <div className="grid-2">
        <label>
          Full name *
          <input name="name" defaultValue={contact.name} required />
        </label>
        <label>
          Type
          <select name="contactType" defaultValue={contact.contact_type ?? ""}>
            <option value="">— classify —</option>
            <option value="broker">Broker</option>
            <option value="owner_user">Owner User</option>
            <option value="institutional_owner">Institutional Owner</option>
            <option value="tenant">Tenant</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Company
          <select
            name="companyId"
            value={companyChoice}
            onChange={(e) => setCompanyChoice(e.target.value)}
          >
            <option value="">— none —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW_COMPANY}>+ New company…</option>
          </select>
        </label>
        <label>
          Title
          <input name="title" defaultValue={contact.title ?? ""} />
        </label>
        {companyChoice === NEW_COMPANY && (
          <>
            <label>
              New company name *
              <input name="newCompanyName" required />
            </label>
            <label>
              Company type
              <select name="newCompanyType" defaultValue="broker">
                <option value="broker">Broker</option>
                <option value="landlord">Landlord</option>
                <option value="tenant">Tenant</option>
                <option value="jv_partner">JV partner</option>
                <option value="other">Other</option>
              </select>
            </label>
          </>
        )}
        <label>
          Email
          <input name="email" type="email" defaultValue={contact.email ?? ""} />
        </label>
        <label>
          Phone
          <input name="phone" defaultValue={contact.phone ?? ""} />
        </label>
      </div>
      <label>
        Address
        <input name="address" defaultValue={contact.address ?? ""} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="stage-actions" style={{ marginBottom: 0 }}>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="button" className="danger-link" onClick={handleDelete} disabled={busy}>
          Delete contact
        </button>
      </div>
    </form>
  );
}
