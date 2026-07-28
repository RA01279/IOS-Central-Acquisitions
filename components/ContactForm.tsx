"use client";
// components/ContactForm.tsx
//
// Add-contact form. First and last name are required, and every new contact
// must be assigned to a company -- either picked from the list or created
// inline (so assignment is never skipped for lack of a company record).
// Email, phone, and address are nice-to-haves.

import { useState } from "react";
import { useRouter } from "next/navigation";

const NEW_COMPANY = "__new__";

export default function ContactForm({
  companies,
}: {
  companies: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [companyChoice, setCompanyChoice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          contactType: form.get("contactType"),
          email: form.get("email") || undefined,
          phone: form.get("phone") || undefined,
          title: form.get("title") || undefined,
          address: form.get("address") || undefined,
          companyId: companyChoice !== NEW_COMPANY ? companyChoice : undefined,
          newCompanyName: companyChoice === NEW_COMPANY ? form.get("newCompanyName") : undefined,
          newCompanyType: companyChoice === NEW_COMPANY ? form.get("newCompanyType") : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add contact");
      setOpen(false);
      setCompanyChoice("");
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
          Type *
          <select name="contactType" required defaultValue="">
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
        <label>
          Company *
          <select
            name="companyId"
            required
            value={companyChoice}
            onChange={(e) => setCompanyChoice(e.target.value)}
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
          Title
          <input name="title" />
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
          <input name="email" type="email" />
        </label>
        <label>
          Phone
          <input name="phone" />
        </label>
      </div>
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
