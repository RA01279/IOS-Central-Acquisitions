"use client";
import { useEffect, useRef, useState } from "react";
import { pdfText } from "@/lib/pdf-text";
import { aiReadComps, readableText, type CompSourcePart } from "@/lib/comps/ai-read";

export type { CompSourcePart };
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
    // The body is read by the Hopper helper (the comp-import agent), which
    // copes with whatever layout the broker used; the rule-based parser is
    // the fallback when the helper can't answer.
    const rulesPart: CompSourcePart = { label: "Email body", payload: { ...email, attachmentsRead: files.length > 0 } };
    const parts: CompSourcePart[] = [];
    setStep("Reading the email body with the Hopper helper… (usually under a minute)");
    try {
      const body = readableText(result.html, result.text);
      const read = await aiReadComps(`BROKER EMAIL (subject: ${message.subject}; from: ${message.sender}):\n${body}`, { label: "Email body", sourceRef: ref, source: "email", alive: () => alive.current });
      if (read.parts.length) parts.push(...read.parts);
      else if (!files.length) parts.push({ ...rulesPart, warnings: ["The Hopper helper found no executed leases or closed sales in the body; this is the rule-based reading.", ...read.notes] });
      else if (read.notes.length) parts.push({ label: "Email body", payload: null, warnings: read.notes });
    } catch (e) {
      parts.push({ ...rulesPart, warnings: [`The Hopper helper couldn't read the body (${e instanceof Error ? e.message : "unknown error"}); this is the rule-based reading. Check it closely.`] });
    }
    if (message.hasAttachments && !files.length) {
      parts.push({ label: "Attachments", payload: null, warnings: ["This email's attachments aren't spreadsheets or PDFs, so only its body was read."] });
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
          const read = await aiReadComps(`COMP SHEET (${f.name}):\n${pdf.text}\n\nBROKER EMAIL:\n${result.text.slice(0, 8000)}`, { label: f.name, sourceRef: `${ref} | ${f.name}`, source: "email", alive: () => alive.current });
          if (!read.parts.length) { parts.push({ label: f.name, payload: null, warnings: ["No executed leases or closed sales found in this PDF.", ...read.notes] }); continue; }
          parts.push(...read.parts);
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
