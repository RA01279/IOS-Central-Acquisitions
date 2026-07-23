"use client";
// components/CompanyForm.tsx
//
// Inline add-company form for the Contacts page. Collapsed to a button until
// opened, so the page stays scannable.

import { useState } from "react";
import { useRouter } from "next/navigation";

const COMPANY_TYPES = [
  { value: "broker", label: "Broker" },
  { value: "landlord", label: "Landlord" },
  { value: "tenant", label: "Tenant" },
  { value: "jv_partner", label: "JV partner" },
  { value: "other", label: "Other" },
];

export default function CompanyForm() {
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
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          companyType: form.get("companyType"),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add company");
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button className="secondary" onClick={() => setOpen(true)}>
        + Add company
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="inline-add-form">
      <div className="grid-2">
        <label>
          Company name
          <input name="name" required autoFocus />
        </label>
        <label>
          Type
          <select name="companyType" defaultValue="broker">
            {COMPANY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="stage-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add company"}
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
