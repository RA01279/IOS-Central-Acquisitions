"use client";
// components/ExcelUploadForm.tsx
//
// Underwriting upload, in two hops: (1) the browser pushes the workbook
// STRAIGHT to Supabase Storage via a signed URL -- bypassing Vercel's ~4.5MB
// request cap that 413'd real models -- then (2) tells the API where it
// landed so the server parses it and records the version.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function ExcelUploadForm({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setWarnings([]);

    try {
      // 1. Get a signed upload slot.
      setStatus("Preparing upload…");
      const urlRes = await fetch(`/api/deals/${dealId}/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name }),
      });
      if (!urlRes.ok) throw new Error((await urlRes.json()).error ?? "Could not start upload");
      const { path, token } = await urlRes.json();

      // 2. Push the file directly to storage (no server size limit).
      setStatus("Uploading workbook…");
      const supabase = getSupabaseBrowserClient();
      const { error: upErr } = await supabase.storage
        .from("documents")
        .uploadToSignedUrl(path, token, file);
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      // 3. Ask the server to parse it and record the version.
      setStatus("Reading workbook…");
      const res = await fetch(`/api/deals/${dealId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: path, fileName: file.name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Processing failed");
      setWarnings(body.warnings ?? []);
      setFile(null);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setStatus(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="excel-upload-form">
      {/* Both Excel formats the parser can actually read:
          .xlsx -- IOS models ("Summary Table" tab)
          .xlsm -- industrial models ("_Upload_" tab), which ship macro-enabled
          Listing only .xlsx here made Windows' file dialog HIDE every industrial
          model, so they looked absent from the folder rather than rejected.
          Deliberately NOT .xls or .xlsb: ExcelJS can't read either, so offering
          them would trade an invisible file for a confusing parse failure. */}
      <input
        type="file"
        accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button type="submit" disabled={!file || status !== null}>
        {status ?? "Upload underwriting"}
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
