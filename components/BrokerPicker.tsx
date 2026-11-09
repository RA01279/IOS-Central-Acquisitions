"use client";
// components/BrokerPicker.tsx
//
// Where a broker goes onto a deal: New Deal, portfolio import, and the deal's
// Contacts panel. Type a name to pick someone already in Contacts, or add
// whoever was typed / imported ("Jane Smith & Tom Ruiz, CBRE"). Each person
// then shows as:
//   in contacts  -- an exact match (same email, or same name at the firm)
//   new contact  -- nobody like them yet; saved as a broker with their firm
//   did you mean -- someone close (Jim vs James, a typo, another firm): you
//                   pick one or say it's someone new. Nothing merges silently.
// The parent can't submit while a "did you mean" is open (unresolvedBrokers).

import { useEffect, useRef, useState } from "react";
import type { BrokerCandidate, BrokerEntry, BrokerInput, BrokerMatch } from "@/lib/broker-match";

export type PickedBroker =
  | { kind: "existing"; contactId: string; name: string; firm: string | null }
  | { kind: "new"; name: string; firm: string | null; email: string | null; phone: string | null }
  | { kind: "choose"; input: BrokerInput; close: BrokerCandidate[] };

type Suggestion = { id: string; name: string; firm: string | null; broker: boolean };

/** What to send the server: picked contacts by id, new people by name. */
export function brokerEntriesOf(list: PickedBroker[]): BrokerEntry[] {
  return list.flatMap((b): BrokerEntry[] =>
    b.kind === "existing" ? [{ contactId: b.contactId }] : b.kind === "new" ? [{ name: b.name, firm: b.firm, email: b.email, phone: b.phone }] : []
  );
}

export function unresolvedBrokers(list: PickedBroker[]): string[] {
  return list.filter((b): b is Extract<PickedBroker, { kind: "choose" }> => b.kind === "choose").map((b) => b.input.name);
}

/** Who's this (text, or people an import split out)? Sort each into existing / new / choose. */
export async function resolveBrokerText(source: string | BrokerInput[]): Promise<PickedBroker[]> {
  const res = await fetch("/api/contacts/brokers", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(typeof source === "string" ? { text: source } : { people: source }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Couldn't look up that broker");
  return (body.brokers as BrokerMatch[]).map((m): PickedBroker =>
    m.exact
      ? { kind: "existing", contactId: m.exact.id, name: m.exact.name, firm: m.exact.company_name }
      : m.close.length
        ? { kind: "choose", input: m.input, close: m.close }
        : { kind: "new", name: m.input.name, firm: m.input.firm, email: m.input.email, phone: m.input.phone }
  );
}

/** Adds without repeating a contact (or a new name) already in the list. */
function merge(list: PickedBroker[], more: PickedBroker[]): PickedBroker[] {
  const key = (b: PickedBroker) => (b.kind === "existing" ? `id:${b.contactId}` : `name:${(b.kind === "new" ? b.name : b.input.name).toLowerCase()}`);
  const seen = new Set(list.map(key));
  return [...list, ...more.filter((b) => !seen.has(key(b)) && seen.add(key(b)))];
}

export default function BrokerPicker({
  value,
  onChange,
  initialText,
  initialPeople,
  placeholder = "Name, or paste “Jane Smith, CBRE”",
  disabled,
  autoFocus,
}: {
  value: PickedBroker[];
  onChange: (next: PickedBroker[]) => void;
  /** Imported text ("Jane Smith, CBRE") to look up once on mount. */
  initialText?: string | null;
  /** Brokers an import already split out (name, firm, email, phone); wins over initialText. */
  initialPeople?: BrokerInput[] | null;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The latest list, for async work that finishes after a re-render.
  const current = useRef(value);
  current.current = value;

  async function add(source: string | BrokerInput[]) {
    const t = typeof source === "string" ? source.trim() : source;
    if (!t.length) return;
    setBusy(true);
    setError(null);
    try {
      onChange(merge(current.current, await resolveBrokerText(t)));
      setQuery("");
      setSuggestions([]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Imported brokers: look them up once.
  const looked = useRef(false);
  useEffect(() => {
    if (looked.current) return;
    if (initialPeople?.length) { looked.current = true; void add(initialPeople); }
    else if (initialText?.trim()) { looked.current = true; void add(initialText); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText, initialPeople]);

  // Type-ahead over the contact book, brokers first.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setSuggestions([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        if (!res.ok) return;
        const { contacts } = await res.json();
        setSuggestions(
          (contacts ?? [])
            .map((c: any) => ({ id: c.id, name: c.name, firm: c.companies?.name ?? null, broker: c.contact_type === "broker" || c.companies?.company_type === "broker" }))
            .sort((a: Suggestion, b: Suggestion) => Number(b.broker) - Number(a.broker))
            .slice(0, 6)
        );
      } catch {}
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query]);

  const replace = (i: number, next: PickedBroker | null) => {
    const list = [...value];
    if (next) list[i] = next; else list.splice(i, 1);
    onChange(merge([], list));
  };

  return (
    <span className="broker-picker">
      {value.map((b, i) => (
        <span key={i} className={b.kind === "choose" ? "broker-choose" : "picked-contact"}>
          {b.kind === "existing" && (
            <>
              <strong>{b.name}</strong>
              {b.firm ? <span className="muted"> · {b.firm}</span> : null}
              <span className="muted"> · in contacts</span>
            </>
          )}
          {b.kind === "new" && (
            <>
              <strong>{b.name}</strong>
              {b.firm && b.firm !== b.name ? <span className="muted"> · {b.firm}</span> : null}
              {b.email ? <span className="muted"> · {b.email}</span> : null}
              <span className="muted"> · new contact</span>
            </>
          )}
          {b.kind === "choose" && (
            <>
              <span>
                Did you mean…? <strong>{b.input.name}</strong>
                {b.input.firm ? <span className="muted"> ({b.input.firm})</span> : null} looks like someone already in Contacts:
              </span>
              <span className="stage-actions" style={{ margin: "6px 0 0" }}>
                {b.close.map((c) => (
                  <button key={c.id} type="button" className="secondary" disabled={disabled}
                    onClick={() => replace(i, { kind: "existing", contactId: c.id, name: c.name, firm: c.company_name })}>
                    {c.name}{c.company_name ? ` · ${c.company_name}` : ""}{c.email ? ` · ${c.email}` : ""}
                  </button>
                ))}
                <button type="button" className="secondary" disabled={disabled}
                  onClick={() => replace(i, { kind: "new", name: b.input.name, firm: b.input.firm, email: b.input.email, phone: b.input.phone })}>
                  No, add {b.input.name} as new
                </button>
              </span>
            </>
          )}
          {!disabled && (
            <button type="button" className="link-remove" title="Remove" onClick={() => replace(i, null)}>×</button>
          )}
        </span>
      ))}
      {!disabled && (
        <span className="combo">
          <input
            value={query}
            autoFocus={autoFocus}
            placeholder={value.length ? "Add another broker…" : placeholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void add(query); }
            }}
            onBlur={() => setTimeout(() => setSuggestions([]), 150)}
          />
          {query.trim().length > 0 && (
            <span className="combo-list">
              {suggestions.map((s) => (
                <button key={s.id} type="button" className="combo-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onChange(merge(value, [{ kind: "existing", contactId: s.id, name: s.name, firm: s.firm }])); setQuery(""); setSuggestions([]); }}>
                  <strong>{s.name}</strong>
                  {s.firm ? <span className="muted"> · {s.firm}</span> : null}
                </button>
              ))}
              <button type="button" className="combo-item combo-create" disabled={busy}
                onMouseDown={(e) => e.preventDefault()} onClick={() => void add(query)}>
                {busy ? "Looking up…" : `+ Add “${query.trim()}”`}
              </button>
            </span>
          )}
        </span>
      )}
      {busy && !query && <span className="muted">Looking up broker…</span>}
      {error && <span className="error">{error}</span>}
    </span>
  );
}
