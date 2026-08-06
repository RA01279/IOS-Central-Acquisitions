"use client";
// components/ContactRowActions.tsx
//
// Inline controls on each contacts-list row: reclassify via a small type
// select, and delete with a confirm. No need to open the contact page.

import { useState } from "react";
import { useRouter } from "next/navigation";

const TYPES = [
  { value: "", label: "unclassified" },
  { value: "broker", label: "Broker" },
  { value: "owner_user", label: "Owner User" },
  { value: "institutional_owner", label: "Institutional Owner" },
  { value: "tenant", label: "Tenant" },
  { value: "other", label: "Other" },
];

export function ContactTypeSelect({
  contactId,
  contactType,
}: {
  contactId: string;
  contactType: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function change(value: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactType: value || null }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      className="row-type-select"
      value={contactType ?? ""}
      onChange={(e) => change(e.target.value)}
      disabled={busy}
      title="Reclassify"
    >
      {TYPES.map((t) => (
        <option key={t.value} value={t.value}>
          {t.label}
        </option>
      ))}
    </select>
  );
}

export function ContactDeleteButton({
  contactId,
  name,
}: {
  contactId: string;
  name: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!window.confirm(`Delete ${name} permanently? Their deal links go too.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="card-delete contact-row-delete" onClick={del} disabled={busy} title="Delete contact">
      {busy ? "…" : "×"}
    </button>
  );
}
