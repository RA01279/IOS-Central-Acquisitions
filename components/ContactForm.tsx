"use client";
// components/ContactForm.tsx
//
// Add-contact form. First and last name are required, and every new contact
// must be assigned to a company -- either picked from the list or created
// inline. Classification flows both ways: picking a typed company auto-fills
// the contact's Type; creating a new company files it under the contact's
// Type (a broker's firm becomes a broker company).

import { useState } from "react";
import { useRouter } from "next/navigation";

const NEW_COMPANY = "__new__";

// companies.company_type -> contact classification
const COMPANY_TO_CONTACT: Record<string, string> = {
  broker: "broker",
  tenant: "tenant",
  landlord: "institutional_owner",
  jv_partner: "other",
  other: "other",
};

export default function ContactForm({
  companies,
}: {
  companies: { id: string; name: string; company_type?: string | null }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [companyChoice, setCompanyChoice] = useState("");
  const [typeChoice, setTypeChoice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickCompany(id: string) {
    setCompanyChoice(id);
    const co = companies.find((c) => c.id === id);
    if (co?.company_type && COMPANY_TO_CONTACT[co.company_type]) {
      setTypeChoice(COMPANY_TO_CONTACT[co.company_type]);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const name = `${(form.get("firstName") as string).trim()} ${(form.get("lastName") as string).trim()}`;
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          contactType: typeChoice,
          email: form.get("email") || undefined,
          phone: form.get("phone") || undefined,
          title: form.get("title") || undefined,
          address: form.get("address") || undefined,
          companyId: companyChoice !== NEW_COMPANY ? companyChoice : undefined,
          newCompanyName: companyChoice === NEW_COMPANY ? form.get("newCompanyName") : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add contact");
      setOpen(false);
      setCompanyChoice("");
      setTypeChoice("");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return <button onClick={() => setOpen(true)}>+ Add contact</button>;
  }

  return (
    <form onSubmit={handleSubmit} className="inline-add-form">
      <div className="grid-2">
        <label>
          First name *
          <input name="firstName" required autoFocus />
        </label>
        <label>
          Last name *
          <input name="lastName" required />
        </label>
        <label>
          Company *
          <select
            name="companyId"
            required
            value={companyChoice}
            onChange={(e) => pickCompany(e.target.value)}
          >
            <option value="" disabled>
              Select…
            </option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW_COMPANY}>+ New company…</option>
          </select>
        </label>
        <label>
          Type *
          <select
            name="contactType"
            required
            value={typeChoice}
            onChange={(e) => setTypeChoice(e.target.value)}
          >
            <option value="" disabled>
              Classify…
            </option>
            <option value="broker">Broker</option>
            <option value="owner_user">Owner User</option>
            <option value="institutional_owner">Institutional Owner</option>
            <option value="tenant">Tenant</option>
            <option value="other">Other</option>
          </select>
        </label>
        {companyChoice === NEW_COMPANY && (
          <label>
            New company name *
            <input name="newCompanyName" required />
          </label>
        )}
        <label>
          Title
          <input name="title" />
        </label>
        <label>
          Email
          <input name="email" type="email" />
        </label>
        <label>
          Phone
          <input name="phone" />
        </label>
      </div>
      {companyChoice === NEW_COMPANY && (
        <p className="hint">The new company will be filed under the contact's type.</p>
      )}
      <label>
        Address
        <input name="address" placeholder="Street, city, state, zip" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="stage-actions" style={{ marginBottom: 0 }}>
        <button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add contact"}
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
