"use client";
// components/ActivityLogForm.tsx
//
// Log a touchpoint -- call, email, meeting, tour, or a plain note -- against
// whatever the user is looking at (contact, company, and/or deal). The ids
// come in as props from the server page.

import { useState } from "react";
import { useRouter } from "next/navigation";

const TYPES = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "tour", label: "Tour" },
  { value: "note", label: "Note" },
];

export default function ActivityLogForm({
  contactId,
  companyId,
  dealId,
}: {
  contactId?: string;
  companyId?: string;
  dealId?: string;
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
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityType: form.get("activityType"),
          subject: form.get("subject") || undefined,
          body: form.get("body") || undefined,
          contactId,
          companyId,
          dealId,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to log activity");
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
        + Log activity
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="inline-add-form">
      <div className="grid-2">
        <label>
          Type
          <select name="activityType" defaultValue="call">
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Subject
          <input name="subject" placeholder="e.g. Priced the deal with seller's broker" />
        </label>
      </div>
      <label>
        Details
        <textarea name="body" rows={3} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="stage-actions" style={{ marginBottom: 0 }}>
        <button type="submit" disabled={submitting}>
          {submitting ? "Logging…" : "Log activity"}
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
