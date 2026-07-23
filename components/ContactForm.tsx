"use client";
// components/ContactForm.tsx
//
// Inline add-contact form for the Contacts page. Company options come from
// the server page as props (keeps server-only lib code out of the client
// bundle).

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ContactForm({
  companies,
}: {
  companies: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email") || undefined,
          phone: form.get("phone") || undefined,
          title: form.get("title") || undefined,
          companyId: form.get("companyId") || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add contact");
      setOpen(false);
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
          Name
          <input name="name" required autoFocus />
        </label>
        <label>
          Company
          <select name="companyId" defaultValue="">
            <option value="">— none —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Email
          <input name="email" type="email" />
        </label>
        <label>
          Phone
          <input name="phone" />
        </label>
        <label>
          Title
          <input name="title" />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="stage-actions">
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
