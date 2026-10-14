"use client";
import { useEffect, useRef, useState } from "react";
import { pdfText } from "@/lib/pdf-text";
import { parseCompImport } from "@/lib/agents/comp-import";

/** One source of comp rows: the email body, a spreadsheet, or a PDF read by the comp-import agent. */
export type CompSourcePart = { label: string | null; payload: Record<string, unknown> | null; warnings?: string[] };
type Attachment = { path: string; name: string; size: number };
type Email = { id: string; subject: string; sender: string; receivedAt: string; preview: string; hasAttachments: boolean; searchJobId: string };
type Status = { paired: boolean; online: boolean; mailbox?: string };
export default function OutlookCompPicker({ onSelect, disabled, hasDrafts }: {
  onSelect: (parts: CompSourcePart[]) => Promise<void>; disabled: boolean; hasDrafts: boolean;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [messages, setMessages] = useState<Email[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [step, setStep] = useState("");
  const alive = useRef(true);
  async function api(path = "", init?: RequestInit) {
    const response = await fetch("/api/outlook-helper" + path, { ...init, cache: "no-store", signal: AbortSignal.timeout(25000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not reach the Outlook helper.");
    return data;
  }
  useEffect(() => {
    alive.current = true;
    const refresh = async () => {
      try { const data = await api(); if (alive.current) { setStatus(data); if (data.online) setPairingCode(""); } }
      catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Could not check the helper."); }
    };
    void refresh(); const timer = setInterval(refresh, 10000);
    return () => { alive.current = false; clearInterval(timer); };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Could not read Outlook."); }
    finally { if (alive.current) { setBusy(false); setStep(""); } }
  }
  async function job(kind: "search" | "fetch" | "fetch_comps", input: Record<string, unknown>) {
    const { id } = await api("", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "enqueue", kind, input }) });
    const deadline = Date.now() + 180000;
    while (alive.current && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (!alive.current) throw new Error("Email request cancelled.");
      const data = await api("?job=" + encodeURIComponent(id));
      if (data.status === "failed") throw new Error(data.error || "Email request failed.");
      if (data.status === "completed") return { id, result: data.result };
    }
    throw new Error("The helper is taking too long. Check that it is still running, then search again.");
  }
  /** Run the comp-import agent on a PDF's text and wait for its tables. */
  async function readPdfComps(text: string) {
    const post = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "comp-import", text: text.slice(0, 98000) }) });
    const queued = await post.json();
    if (!post.ok) throw new Error(queued.error || "Could not start reading the PDF.");
    const deadline = Date.now() + 10 * 60000;
    while (alive.current && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const res = await fetch(`/api/agents?id=${queued.id}`, { cache: "no-store" });
      const run = await res.json();
      if (run.status === "failed") throw new Error(run.error || "The helper could not read this PDF.");
      if (run.status === "completed") {
        const parsed = parseCompImport(run.result?.report ?? "");
        if (!parsed) throw new Error("No comp rows found in this PDF.");
        return parsed;
      }
    }
    throw new Error("Reading the PDF is taking too long. Check the helper is still running.");
  }

  /**
   * The email body plus every comp attachment, as parts for the intake form:
   * spreadsheets go through the same reader as Upload spreadsheet, PDFs through
   * the comp-import agent and then the same table parser as a paste.
   */
  async function readEmail(message: Email) {
    setStep(message.hasAttachments ? "Fetching the email and its attachments…" : "Fetching the email…");
    const { result } = await job("fetch_comps", { messageId: message.id, searchJobId: message.searchJobId });
    const files: Attachment[] = result.attachments ?? [];
    const { attachments: _files, ...email } = result;
    setSourceText(result.text);
    const ref = result.sourceRef || message.subject;
    const parts: CompSourcePart[] = [{ label: "Email body", payload: { ...email, attachmentsRead: files.length > 0 } }];
    if (message.hasAttachments && !files.length) {
      parts[0].warnings = ["This email's attachments aren't spreadsheets or PDFs, so only its body was read."];
    }
    for (const f of files) {
      setStep(`Reading ${f.name}…`);
      try {
        const signed = await fetch(`/api/imports?path=${encodeURIComponent(f.path)}`, { cache: "no-store" });
        const { url, error: urlError } = await signed.json();
        if (!signed.ok) throw new Error(urlError || "Attachment expired.");
        const buf = await (await fetch(url)).arrayBuffer();
        if (/\.pdf$/i.test(f.path)) {
          const pdf = await pdfText(buf, 90000);
          if (pdf.scanned) { parts.push({ label: f.name, payload: null, warnings: ["A scanned PDF with no text layer, so it can't be read. Enter its comps by hand."] }); continue; }
          setStep(`Reading ${f.name} with the Hopper helper… (usually under a minute)`);
          const tables = await readPdfComps(`COMP SHEET (${f.name}):\n${pdf.text}\n\nBROKER EMAIL:\n${result.text.slice(0, 8000)}`);
          const warn = ["Read from a PDF. Check each row against the sheet before saving.", ...tables.notes];
          if (!tables.leases && !tables.sales) { parts.push({ label: f.name, payload: null, warnings: ["No executed leases or closed sales found in this PDF.", ...tables.notes] }); continue; }
          if (tables.leases) parts.push({ label: f.name, payload: { text: tables.leases, defaultCompType: "lease", source: "email", sourceRef: `${ref} | ${f.name}` }, warnings: warn });
          if (tables.sales) parts.push({ label: f.name, payload: { text: tables.sales, defaultCompType: "sale", source: "email", sourceRef: `${ref} | ${f.name}` }, warnings: tables.leases ? [] : warn });
        } else {
          let binary = "";
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          parts.push({ label: f.name, payload: { fileBase64: btoa(binary), fileName: f.name, sourceRef: `${ref} | ${f.name}` } });
        }
      } catch (e) {
        parts.push({ label: f.name, payload: null, warnings: [`Couldn't read this attachment: ${e instanceof Error ? e.message : "unknown error"}`] });
      }
    }
    setStep("");
    if (alive.current) await onSelect(parts);
  }
  async function search(append = false) {
    const text = append ? searchedQuery : query;
    const { id, result } = await job("search", { query: text, fromIndex: append ? next : 0 });
    if (!alive.current) return;
    const items = result.messages.map((m: Email) => ({ ...m, searchJobId: id }));
    setMessages(previous => append ? [...previous, ...items.filter((m: Email) => !previous.some(p => p.id === m.id))] : items);
    setNext(result.nextFromIndex); setSearchedQuery(text); setLoaded(true);
  }
  return <div className="panel" aria-label="Outlook email picker">
    <h3>Select an Outlook email</h3>
    <p className="hint">Search by address, broker, or subject. Choose an email to review its sale and lease comps before saving. Spreadsheet and PDF attachments are read too.</p>
    <p role="status">{status?.online ? "Outlook helper online" + (status.mailbox ? " · " + status.mailbox : "") :
      status?.paired ? "Outlook helper offline — start it on your computer." : status ? "Connect your computer once to use your existing Outlook plugin." : "Checking your Outlook helper…"}</p>
    <fieldset disabled={disabled || busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
      {!status?.online && <details open={!status?.paired}>
        <summary>Set up the Outlook helper</summary>
        <p>On your computer, open the Hopper project and run <code>npm run outlook:helper -- --pair</code>. Generate a code below and paste it into the helper when prompted. Keep the helper running while importing.</p>
        <button type="button" onClick={() => void run(async () => {
          const data = await api("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pair" }) });
          setPairingCode(data.token); setStatus({ paired: true, online: false }); setMessages([]); setLoaded(false);
        })}>{status?.paired ? "Generate replacement pairing code" : "Generate pairing code"}</button>
        {pairingCode && <div>
          <label htmlFor="outlook-helper-code">Pairing code — keep private</label>
          <input id="outlook-helper-code" readOnly value={pairingCode} onFocus={e => e.target.select()} style={{ width: "100%" }} />
          <button type="button" className="secondary" onClick={() => void run(() => navigator.clipboard.writeText(pairingCode))}>Copy code</button>
        </div>}
      </details>}
      {status?.paired && <button type="button" className="secondary" onClick={() => void run(async () => {
        await api("", { method: "DELETE" }); setStatus({ paired: false, online: false }); setMessages([]); setPairingCode(""); setLoaded(false); setSourceText("");
      })}>Disconnect helper</button>}
      <label htmlFor="outlook-comp-search">Find an email</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
        <input id="outlook-comp-search" value={query} maxLength={200} placeholder="Address, broker, or subject"
          onChange={e => setQuery(e.target.value)} onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); if (status?.online) void run(() => search()); }
          }} />
        <button type="button" disabled={!status?.online} onClick={() => void run(() => search())}>Search Outlook</button>
      </div>
      {hasDrafts && <p className="warning">Finish or discard the current comp review before selecting another email.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {messages.map(message => <li key={message.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
          <strong>{message.subject || "(No subject)"}</strong>
          <p className="hint">{message.sender} · {message.receivedAt ? new Date(message.receivedAt).toLocaleString() : "Date unavailable"}</p>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message.preview}</p>
          {message.hasAttachments && <p className="hint">Has attachments. Spreadsheets and PDF comp sheets are read along with the email.</p>}
          <button type="button" disabled={hasDrafts || !status?.online} onClick={() => void run(() => readEmail(message))}>
            Read comps from this email
          </button>
        </li>)}
      </ul>
      {loaded && !messages.length && <p>No matching emails. Try another address, broker, or subject.</p>}
      {next !== null && <button type="button" disabled={!status?.online} onClick={() => void run(() => search(true))}>Load more emails</button>}
    </fieldset>
    {busy && <p role="status">{step || "Reading Outlook through your computer…"}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {sourceText && <details><summary>Review source email</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 360, overflow: "auto" }}>{sourceText}</pre></details>}
  </div>;
}
