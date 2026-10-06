"use client";
// components/DealImport.tsx
//
// New Deal > Import: start a deal from an OM (PDF upload) or a broker email
// picked from Outlook. The PDF's text is read here in the browser (pdf.js),
// the "deal-import" agent on the Hopper helper turns it into form fields, and
// the New Deal form fills in for review. Nothing is created until the person
// checks the form and clicks Create; the OM then files to the deal.

import { useEffect, useRef, useState } from "react";
import { FileUp, Mail, Paperclip, CircleCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { parseDealImport, type DealImport as Draft } from "@/lib/agents/deal-import";
import { pdfText } from "@/lib/pdf-text";

export interface ImportedFile {
  path: string;
  name: string;
}

type Email = { id: string; subject: string; sender: string; receivedAt: string; preview: string; hasAttachments: boolean; searchJobId: string };

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
const post = (url: string, body: unknown) =>
  json(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function DealImport({
  onImported,
}: {
  onImported: (draft: Draft, file: ImportedFile | null, source: string) => void;
}) {
  const [mode, setMode] = useState<"upload" | "outlook">("upload");
  const [agentsOnline, setAgentsOnline] = useState<boolean | null>(null);
  const [mail, setMail] = useState<{ paired: boolean; online: boolean } | null>(null);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Email[]>([]);
  const [drag, setDrag] = useState(false);
  const alive = useRef(true);
  const busy = !!step;

  useEffect(() => {
    alive.current = true;
    const check = async () => {
      try {
        const a = await json("/api/agents");
        if (alive.current) setAgentsOnline(!!a.online);
      } catch {
        if (alive.current) setAgentsOnline(false);
      }
      try {
        const m = await json("/api/outlook-helper");
        if (alive.current) setMail({ paired: !!m.paired, online: !!m.online });
      } catch {
        if (alive.current) setMail({ paired: false, online: false });
      }
    };
    void check();
    const t = setInterval(check, 15000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, []);

  async function run(fn: () => Promise<void>) {
    setError("");
    try {
      await fn();
    } catch (e: any) {
      if (alive.current) setError(e?.message ?? "Import failed");
    } finally {
      if (alive.current) setStep("");
    }
  }

  /** Queue the deal-import agent on the helper and wait for its draft. */
  async function extract(text: string): Promise<Draft> {
    setStep("Reading the document with the Hopper helper… (usually under a minute)");
    const { id } = await post("/api/agents", { agent: "deal-import", text: text.slice(0, 98000) });
    const deadline = Date.now() + 10 * 60000;
    while (alive.current && Date.now() < deadline) {
      await sleep(3000);
      const run = await json(`/api/agents?id=${id}`);
      if (run.status === "failed") throw new Error(run.error || "The helper could not read this document.");
      if (run.status === "completed") {
        const draft = parseDealImport(run.result?.report ?? "");
        if (!draft) throw new Error("Couldn't find a property address in that document.");
        return draft;
      }
    }
    throw new Error("The helper is taking too long. Check it is still running on your computer.");
  }

  async function fromFile(file: File) {
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) throw new Error("Choose a PDF.");
    if (file.size > 40 * 1024 * 1024) throw new Error("That PDF is over 40 MB.");
    setStep("Reading the PDF…");
    const buf = await file.arrayBuffer();
    const { text, scanned } = await pdfText(buf);
    if (scanned) throw new Error("This PDF is a scan with no text layer, so it can't be read. Try the broker's email or a text-based OM.");
    setStep("Uploading the OM…");
    const slot = await post("/api/imports", { action: "upload_url" });
    const { error } = await getSupabaseBrowserClient().storage.from("documents").uploadToSignedUrl(slot.path, slot.token, file, {
      contentType: "application/pdf",
    });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    const draft = await extract(`OFFERING MEMORANDUM (${file.name}):\n${text}`);
    onImported(draft, { path: slot.path, name: file.name }, file.name);
  }

  /** Run an Outlook helper job (search or fetch_om) and wait for its result. */
  async function mailJob(kind: "search" | "fetch_om", input: Record<string, unknown>) {
    const { id } = await post("/api/outlook-helper", { action: "enqueue", kind, input });
    const deadline = Date.now() + 180000;
    while (alive.current && Date.now() < deadline) {
      await sleep(1500);
      const job = await json(`/api/outlook-helper?job=${encodeURIComponent(id)}`);
      if (job.status === "failed") throw new Error(job.error || "Email request failed.");
      if (job.status === "completed") return { id, result: job.result };
    }
    throw new Error("Outlook is taking too long. Check the helper is running, then try again.");
  }

  async function search() {
    setStep("Searching Outlook…");
    const { id, result } = await mailJob("search", { query: query.trim(), fromIndex: 0 });
    setMessages(result.messages.map((m: Email) => ({ ...m, searchJobId: id })));
    if (!result.messages.length) setError("No matching emails. Try the address, broker or subject.");
  }

  async function fromEmail(m: Email) {
    setStep(m.hasAttachments ? "Fetching the email and its PDF attachments…" : "Fetching the email…");
    const { result } = await mailJob("fetch_om", { messageId: m.id, searchJobId: m.searchJobId });
    const files: ImportedFile[] = result.attachments ?? [];
    let text = `BROKER EMAIL (${result.sourceRef || m.subject}):\n${result.text}`;
    for (const f of files) {
      setStep(`Reading ${f.name}…`);
      const { url } = await json(`/api/imports?path=${encodeURIComponent(f.path)}`);
      const buf = await (await fetch(url)).arrayBuffer();
      const pdf = await pdfText(buf, 45000);
      if (!pdf.scanned) text += `\n\nATTACHED PDF (${f.name}):\n${pdf.text}`;
    }
    const draft = await extract(text);
    onImported(draft, files[0] ?? null, m.subject || "Outlook email");
  }

  const helperNote =
    agentsOnline === false ? (
      <p className="warning" style={{ margin: 0 }}>
        The Hopper helper isn&apos;t running on your computer. Start it with <code>npm run outlook:helper</code> in the Hopper folder
        (first time: pair it from <a href="/comps">Comps</a>).
      </p>
    ) : null;

  return (
    <section className="card" style={{ marginBottom: 20 }} aria-label="Import a deal">
      <div className="card-head">
        <span className="overline">Start from an OM or email</span>
        <div className="seg">
          <button type="button" className={mode === "upload" ? "on" : ""} onClick={() => setMode("upload")} style={{ fontFamily: "var(--font-body)" }}>
            Upload OM
          </button>
          <button type="button" className={mode === "outlook" ? "on" : ""} onClick={() => setMode("outlook")} style={{ fontFamily: "var(--font-body)" }}>
            From Outlook
          </button>
        </div>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Hopper reads it and fills in the form below. Nothing is created until you check the form and click Create deal.
      </p>
      {helperNote}

      {mode === "upload" ? (
        <label
          className="om-drop"
          data-drag={drag || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f && !busy && agentsOnline) void run(() => fromFile(f));
          }}
          aria-disabled={busy || !agentsOnline}
        >
          <FileUp size={22} color="#0E5AA7" />
          <span>
            <strong>Drop the OM here</strong> or click to choose a PDF
          </span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy || !agentsOnline}
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void run(() => fromFile(f));
            }}
          />
        </label>
      ) : mail && !mail.paired ? (
        <p className="hint" style={{ margin: 0 }}>
          Pair the Outlook helper first from <a href="/comps">Comps</a> (one-time), then come back here.
        </p>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) void run(search);
            }}
            style={{ display: "flex", gap: 8 }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Address, broker or subject"
              maxLength={200}
              disabled={busy || !mail?.online}
              style={{ flex: 1, font: "inherit", fontSize: 14, padding: "8px 10px", border: "1px solid #C4CFD9", borderRadius: 3 }}
            />
            <button type="submit" disabled={busy || !mail?.online || !query.trim()}>
              Search Outlook
            </button>
          </form>
          {mail && !mail.online && <p className="hint" style={{ margin: 0 }}>Outlook helper offline. Start it on your computer.</p>}
          {messages.length > 0 && (
            <div className="list-rows">
              {messages.map((m) => (
                <div key={m.id} className="list-row" style={{ cursor: "default" }}>
                  <Mail size={16} color="#5E7A93" style={{ flex: "none" }} />
                  <span className="grow">
                    <b>{m.subject || "(No subject)"}</b>
                    <span>
                      {m.sender} · {m.receivedAt ? new Date(m.receivedAt).toLocaleDateString() : ""}
                      {m.hasAttachments && (
                        <>
                          {" · "}
                          <Paperclip size={11} style={{ verticalAlign: -1 }} /> attachments
                        </>
                      )}
                    </span>
                  </span>
                  <button type="button" disabled={busy || !agentsOnline} onClick={() => void run(() => fromEmail(m))}>
                    Import
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {step && (
        <p role="status" className="hint" style={{ margin: 0, color: "#0E5AA7" }}>
          <span className="spin" style={{ display: "inline-block", marginRight: 6 }}>◌</span>
          {step}
        </p>
      )}
      {error && (
        <p className="error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </section>
  );
}

export function ImportReview({ draft, source, file }: { draft: Draft; source: string; file: ImportedFile | null }) {
  const LABELS: Record<string, string> = {
    address: "Address",
    city: "City",
    state: "State",
    market: "Market",
    acres: "Acres",
    buildingSf: "Building SF",
    askingPrice: "Asking price",
    occupancy: "Occupancy",
    waltYears: "WALT (yrs)",
    tenancy: "Tenancy",
    assetClass: "Pipeline",
    acquisitionType: "Acquisition type",
    marketingStatus: "Source",
    sellerBroker: "Sales broker",
    currentOwner: "Current owner",
  };
  const found = Object.entries(draft.fields).filter(([, v]) => v != null);
  const missing = Object.entries(draft.fields).filter(([, v]) => v == null).map(([k]) => LABELS[k]);
  return (
    <div className="card" style={{ marginBottom: 20, borderColor: "#0E5AA7" }}>
      <div className="card-head">
        <span className="overline" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <CircleCheck size={14} color="#2E7D5B" /> Filled from {source}
        </span>
        {file && <span className="hint" style={{ margin: 0 }}>OM will be filed to the deal&apos;s documents</span>}
      </div>
      <p className="hint" style={{ margin: 0 }}>Check each field below before creating. Hover a value to see the line it came from.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {found.map(([k, v]) => (
          <span key={k} className="fchip" style={{ cursor: "help", paddingRight: 10 }} title={draft.evidence[k as keyof typeof draft.evidence] ?? "No quote given"}>
            {LABELS[k]}: {typeof v === "number" ? v.toLocaleString("en-US") : String(v).replace(/_/g, " ")}
          </span>
        ))}
      </div>
      {missing.length > 0 && <p className="hint" style={{ margin: 0 }}>Not found: {missing.join(", ")}.</p>}
      {draft.notes.length > 0 && (
        <ul className="warning" style={{ margin: 0, paddingLeft: 28 }}>
          {draft.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
