"use client";
// components/NoteComposer.tsx
//
// Add a note to the deal timeline -- most often a site-visit note from a
// phone. Photos go straight to storage via signed URLs. With no connection
// the note (text only) is queued in the outbox (lib/outbox.ts) and posts
// itself when the phone is back online.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Paperclip } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { enqueue } from "@/lib/outbox";

const TYPES = [
  { value: "site_visit", label: "Site visit" },
  { value: "note", label: "Note" },
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "tour", label: "Tour" },
];

export default function NoteComposer({ dealId, initialType, startOpen }: { dealId: string; initialType?: string; startOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(!!startOpen);
  const [type, setType] = useState(TYPES.some((t) => t.value === initialType) ? initialType! : "site_visit");
  const [files, setFiles] = useState<File[]>([]);
  // Documents (PDF, Excel, Word, email...) -- filed in the deal's vault and
  // linked to this note.
  const [attachments, setAttachments] = useState<File[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  async function attach(file: File, activityId: string | undefined) {
    const post = async (body: unknown) => {
      const r = await fetch(`/api/deals/${dealId}/vault`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error ?? "Upload failed");
      return out;
    };
    const { path, token } = await post({ action: "upload-url", fileName: file.name });
    const { error } = await getSupabaseBrowserClient().storage.from("documents").uploadToSignedUrl(path, token, file);
    if (error) throw new Error(error.message);
    await post({ action: "register", path, fileName: file.name, docType: "other", activityId: activityId ?? null });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload: any = {
      activityType: type,
      subject: (f.get("subject") as string) || (type === "site_visit" ? "Site visit" : undefined),
      body: (f.get("body") as string) || undefined,
      dealId,
    };
    setMsg("");

    if (!navigator.onLine) {
      enqueue("/api/activities", payload, payload.subject ?? "Note");
      setMsg(files.length || attachments.length ? "Offline: note saved, photos and files skipped. It will post when you reconnect." : "Offline: note saved and will post when you reconnect.");
      formRef.current?.reset();
      setFiles([]);
      setAttachments([]);
      return;
    }

    try {
      const photoPaths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setBusy(`Uploading photo ${i + 1} of ${files.length}…`);
        const file = files[i];
        const res = await fetch(`/api/deals/${dealId}/photo-upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: file.type }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Upload failed");
        const { error } = await getSupabaseBrowserClient().storage.from("documents").uploadToSignedUrl(json.path, json.token, file);
        if (error) throw new Error(`Upload failed: ${error.message}`);
        photoPaths.push(json.path);
      }
      setBusy("Saving…");
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, photoPaths }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save");
      const activityId: string | undefined = (await res.json().catch(() => ({})))?.activity?.id;
      // The note is saved; now its files. One failing doesn't lose the others
      // or the note -- it's named so it can be attached again from the vault.
      const failed: string[] = [];
      for (let i = 0; i < attachments.length; i++) {
        const file = attachments[i];
        setBusy(`Uploading ${file.name} (${i + 1} of ${attachments.length})…`);
        try {
          await attach(file, activityId);
        } catch (err: any) {
          failed.push(`${file.name}: ${err.message}`);
        }
      }
      formRef.current?.reset();
      setFiles([]);
      setAttachments([]);
      if (failed.length) setMsg(`Note saved, but ${failed.length === 1 ? "a file" : "some files"} didn't upload — ${failed.join("; ")}`);
      else setOpen(false);
      router.refresh();
    } catch (err: any) {
      if (err instanceof TypeError) {
        // Network dropped mid-save: keep the words.
        enqueue("/api/activities", payload, payload.subject ?? "Note");
        setMsg("Connection lost: note queued and will post when you reconnect.");
      } else setMsg(err.message);
    } finally {
      setBusy("");
    }
  }

  if (!open) {
    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => { setType("site_visit"); setOpen(true); }}>
          Add Site-Visit Note
        </button>
        <button type="button" className="secondary" onClick={() => { setType("note"); setOpen(true); }}>
          Add note or touchpoint
        </button>
        {msg && <span className="hint" style={{ margin: 0 }}>{msg}</span>}
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={submit} className="card" style={{ gap: 0 }}>
      <div className="card-head" style={{ marginBottom: 12 }}>
        <span className="overline">New entry</span>
        <div className="seg">
          {TYPES.map((t) => (
            <button key={t.value} type="button" className={type === t.value ? "on" : ""} onClick={() => setType(t.value)} style={{ fontFamily: "var(--font-body)" }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <label>
        Subject
        <input name="subject" placeholder={type === "site_visit" ? "Site visit" : "Optional"} />
      </label>
      <label>
        Notes
        <textarea name="body" rows={4} placeholder={type === "site_visit" ? "Access, surface, fencing, neighbors, anything the photos don't show" : ""} />
      </label>
      {type === "site_visit" && (
        <label style={{ flexDirection: "row", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <Camera size={18} color="#0E5AA7" />
          <span style={{ color: "#0E5AA7", fontWeight: 600 }}>{files.length ? `${files.length} photo${files.length === 1 ? "" : "s"} attached` : "Add photos"}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
            capture="environment"
            multiple
            style={{ display: "none" }}
            onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 12))}
          />
        </label>
      )}
      <label style={{ flexDirection: "row", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <Paperclip size={18} color="#0E5AA7" />
        <span style={{ color: "#0E5AA7", fontWeight: 600 }}>
          {attachments.length ? `${attachments.length} file${attachments.length === 1 ? "" : "s"} attached` : "Attach files (PDF, Excel, Word, email…)"}
        </span>
        <input
          type="file"
          accept=".pdf,.xlsx,.xlsm,.xls,.csv,.doc,.docx,.pptx,.msg,.eml,.txt,.zip,.jpg,.jpeg,.png,.heic,.tif,.tiff,.kmz,.dwg"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { setAttachments([...attachments, ...Array.from(e.target.files ?? [])].slice(0, 20)); e.target.value = ""; }}
        />
      </label>
      {attachments.length > 0 && (
        <ul className="doc-list" style={{ margin: "0 0 10px" }}>
          {attachments.map((f, i) => (
            <li key={i}>
              {f.name} <span className="muted">· {f.size >= 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`}</span>
              <button type="button" className="link-remove" title="Remove" onClick={() => setAttachments(attachments.filter((_, j) => j !== i))} disabled={!!busy}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" disabled={!!busy}>
          {busy || "Save"}
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)} disabled={!!busy}>
          Cancel
        </button>
        {msg && <span className="hint" style={{ margin: 0 }}>{msg}</span>}
      </div>
    </form>
  );
}
