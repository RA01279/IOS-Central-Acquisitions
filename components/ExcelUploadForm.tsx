"use client";
// components/ExcelUploadForm.tsx

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ExcelUploadForm({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setError(null);
    setWarnings([]);

    const form = new FormData();
    form.append("excel", file);

    try {
      const res = await fetch(`/api/deals/${dealId}/versions`, { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      setWarnings(body.warnings ?? []);
      setFile(null);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="excel-upload-form">
      <input
        type="file"
        accept=".xlsx"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button type="submit" disabled={!file || submitting}>
        {submitting ? "Reading workbook…" : "Upload underwriting"}
      </button>

      {error && <p className="error">{error}</p>}
      {warnings.length > 0 && (
        <div className="warning">
          <p>Uploaded, but the parser flagged:</p>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
