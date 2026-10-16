"use client";
// components/DocumentVault.tsx
//
// Every file on the deal, by type, with a download link. Uploads go straight
// to Storage on a signed URL, then are registered with a type and,
// optionally, the milestone they satisfy (ticking it done).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { DOC_FOR_MILESTONE, DOC_TYPE_LABELS, DOC_TYPES } from "@/lib/diligence";

export type VaultDoc = {
  id: string;
  doc_type: string;
  name: string;
  uploaded_by: string;
  uploaded_at: string;
  size_bytes: number | null;
  milestone_label: string | null;
};
export type VaultMilestone = { id: string; key: string | null; label: string; done_on: string | null };

const UPLOAD_TYPES = DOC_TYPES.filter((t) => t.value !== "excel");

function size(n: number | null) {
  if (!n) return "";
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export default function DocumentVault({ dealId, docs, milestones }: { dealId: string; docs: VaultDoc[]; milestones: VaultMilestone[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [markDone, setMarkDone] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  // Picking a type preselects the open milestone that file usually closes.
  function chooseType(t: string) {
    setDocType(t);
    const m = milestones.find((x) => !x.done_on && x.key && DOC_FOR_MILESTONE[x.key] === t);
    setMilestoneId(m?.id ?? "");
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !docType) return;
    setError(null);
    try {
      setStatus("Preparing…");
      const post = async (body: unknown) => {
        const res = await fetch(`/api/deals/${dealId}/vault`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error ?? "Upload failed");
        return out;
      };
      const { path, token } = await post({ action: "upload-url", fileName: file.name });
      setStatus("Uploading…");
      const { error: upErr } = await getSupabaseBrowserClient().storage.from("documents").uploadToSignedUrl(path, token, file);
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      setStatus("Saving…");
      await post({ action: "register", path, fileName: file.name, docType, milestoneId: milestoneId || null, markDone });
      setFile(null);
      setDocType("");
      setMilestoneId("");
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setStatus(null);
    }
  }

  async function remove(d: VaultDoc) {
    if (!confirm(`Delete ${d.name}? This removes the file.`)) return;
    setError(null);
    const res = await fetch(`/api/deals/${dealId}/vault`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId: d.id }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Delete failed");
    router.refresh();
  }

  const types = useMemo(() => [...new Set(docs.map((d) => d.doc_type))], [docs]);
  const shown = filter === "all" ? docs : docs.filter((d) => d.doc_type === filter);

  return (
    <section className="panel">
      <h2>Documents</h2>
      <form onSubmit={upload} className="inline-add-form" style={{ width: "100%" }}>
        <div className="grid-2">
          <label>
            File
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <label>
            Type
            <select value={docType} onChange={(e) => chooseType(e.target.value)} required>
              <option value="">Choose…</option>
              {UPLOAD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          {milestones.length > 0 && (
            <label>
              Satisfies milestone (optional)
              <select value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
                <option value="">None</option>
                {milestones.map((m) => <option key={m.id} value={m.id}>{m.label}{m.done_on ? " (done)" : ""}</option>)}
              </select>
            </label>
          )}
          {milestoneId && (
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} />
              Mark that milestone done today
            </label>
          )}
        </div>
        <div className="stage-actions" style={{ marginBottom: 0 }}>
          <button type="submit" disabled={!file || !docType || status !== null}>{status ?? "Upload"}</button>
          <span className="hint">PDF, Office, images, email or zip, up to 100 MB.</span>
        </div>
      </form>
      {error && <p className="error">{error}</p>}

      {docs.length === 0 ? (
        <p className="hint">No documents on this deal yet.</p>
      ) : (
        <>
          {types.length > 1 && (
            <div className="stage-actions" style={{ marginBottom: 8 }}>
              <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by type">
                <option value="all">All types ({docs.length})</option>
                {types.map((t) => <option key={t} value={t}>{DOC_TYPE_LABELS[t] ?? t} ({docs.filter((d) => d.doc_type === t).length})</option>)}
              </select>
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table className="summary-table">
              <thead>
                <tr><th>File</th><th>Type</th><th>Milestone</th><th>Uploaded</th><th></th></tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.id}>
                    <td><a href={`/api/deals/${dealId}/vault?doc=${d.id}`}>{d.name}</a> <span className="muted">{size(d.size_bytes)}</span></td>
                    <td>{DOC_TYPE_LABELS[d.doc_type] ?? d.doc_type}</td>
                    <td>{d.milestone_label ?? <span className="muted">—</span>}</td>
                    <td><span className="muted">{new Date(d.uploaded_at).toLocaleDateString("en-US")} · {d.uploaded_by.split("@")[0]}</span></td>
                    <td>{d.doc_type !== "excel" && <button type="button" className="secondary" title="Delete" onClick={() => void remove(d)}>×</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
