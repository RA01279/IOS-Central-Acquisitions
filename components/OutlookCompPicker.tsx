"use client";
import { useEffect, useRef, useState } from "react";
type Email = { id: string; subject: string; sender: string; receivedAt: string; preview: string; hasAttachments: boolean; searchJobId: string };
type Status = { paired: boolean; online: boolean; mailbox?: string };
export default function OutlookCompPicker({ onSelect, disabled, hasDrafts }: {
  onSelect: (payload: Record<string, unknown>) => Promise<void>; disabled: boolean; hasDrafts: boolean;
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
    finally { if (alive.current) setBusy(false); }
  }
  async function job(kind: "search" | "fetch", input: Record<string, unknown>) {
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
    <p className="hint">Search by address, broker, or subject. Choose an email to review its sale and lease comps before saving. Attachments must be uploaded separately.</p>
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
          {message.hasAttachments && <p className="hint">Contains attachments. This import reads the email body.</p>}
          <button type="button" disabled={hasDrafts || !status?.online} onClick={() => void run(async () => {
            const { result } = await job("fetch", { messageId: message.id, searchJobId: message.searchJobId });
            if (alive.current) { setSourceText(result.text); await onSelect(result); }
          })}>Read comps from this email</button>
        </li>)}
      </ul>
      {loaded && !messages.length && <p>No matching emails. Try another address, broker, or subject.</p>}
      {next !== null && <button type="button" disabled={!status?.online} onClick={() => void run(() => search(true))}>Load more emails</button>}
    </fieldset>
    {busy && <p role="status">Reading Outlook through your computer…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {sourceText && <details><summary>Review source email</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 360, overflow: "auto" }}>{sourceText}</pre></details>}
  </div>;
}
