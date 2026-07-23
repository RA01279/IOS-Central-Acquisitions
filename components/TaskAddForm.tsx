"use client";
// components/TaskAddForm.tsx
//
// Inline add-follow-up form. Reused on the Tasks page (standalone), contact
// pages (contactId set), and deal pages (dealId set) -- the optional ids tie
// the task to whatever the user was looking at.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TaskAddForm({
  contactId,
  companyId,
  dealId,
  defaultAssignee,
}: {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  defaultAssignee?: string;
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
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          notes: form.get("notes") || undefined,
          dueDate: form.get("dueDate") || undefined,
          assignedTo: form.get("assignedTo") || undefined,
          contactId,
          companyId,
          dealId,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add task");
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
        + Add follow-up
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="inline-add-form">
      <label>
        What needs doing
        <input name="title" required autoFocus placeholder="e.g. Call broker re: pricing guidance" />
      </label>
      <div className="grid-2">
        <label>
          Due date
          <input name="dueDate" type="date" />
        </label>
        <label>
          Assigned to (email)
          <input name="assignedTo" defaultValue={defaultAssignee ?? ""} />
        </label>
      </div>
      <label>
        Notes
        <input name="notes" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="stage-actions" style={{ marginBottom: 0 }}>
        <button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add follow-up"}
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
