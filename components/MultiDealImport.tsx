"use client";
// components/MultiDealImport.tsx
//
// New Deal, when one email or OM covers several SEPARATE properties (a broker's
// "a few sites you might like"): each property is a card with its key fields
// editable, ticked by default. "Create N deals" checks each location with
// Google, saves the broker once and links them to every deal, then creates the
// deals one by one -- each with the broker's commentary on that property as a
// note, and the imported PDF (if any) filed on it. A property Hopper already
// has comes back as "already in Hopper" with a link instead of a duplicate.
// A package sold together is the Portfolio import, not this.

import { useState } from "react";
import BrokerPicker, { brokerEntriesOf, unresolvedBrokers, type PickedBroker } from "./BrokerPicker";
import type { DealImport as Draft } from "@/lib/agents/deal-import";
import type { ImportedFile } from "./DealImport";

type Card = {
  key: string;
  include: boolean;
  address: string;
  city: string | null;
  state: string | null;
  market: string | null;
  acres: number | null;
  buildingSf: number | null;
  askingPrice: number | null;
  assetClass: "ios" | "industrial";
  draft: Draft;
  location: { latitude: number; longitude: number; precision: string } | null;
  locationNote: string | null;
  needsFix: boolean;
  result: { dealId?: string; duplicate?: { id: string; address: string }; error?: string } | null;
};

async function call(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error ?? `Request failed (${res.status})`), { status: res.status, body: out });
  return out;
}
const money = (n: number | null) => (n == null ? "" : n >= 1e6 ? `$${(n / 1e6).toFixed(n % 1e6 ? 2 : 0)}M` : `$${Math.round(n).toLocaleString()}`);

export default function MultiDealImport({ drafts, file, source }: { drafts: Draft[]; file: ImportedFile | null; source: string }) {
  const [cards, setCards] = useState<Card[]>(() => drafts.map((d, i) => ({
    key: String(i), include: true,
    address: d.fields.address ?? "", city: d.fields.city, state: d.fields.state, market: d.fields.market,
    acres: d.fields.acres, buildingSf: d.fields.buildingSf, askingPrice: d.fields.askingPrice,
    assetClass: d.fields.assetClass ?? "ios",
    draft: d, location: null, locationNote: null, needsFix: false, result: null,
  })));
  // One broker for the whole email, picked once and linked to every deal.
  const first = drafts.find((d) => d.fields.sellerBrokers?.length || d.fields.sellerBroker)?.fields;
  const [brokers, setBrokers] = useState<PickedBroker[]>([]);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const busy = !!step;
  const update = (key: string, patch: Partial<Card>) => setCards((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  async function locate(list: Card[]): Promise<Card[]> {
    let out = list;
    const todo = list.filter((c) => c.include && !c.location && !c.result?.dealId);
    for (let i = 0; i < todo.length; i++) {
      const c = todo[i];
      setStep(`Checking locations with Google, ${i + 1} of ${todo.length}: ${c.address}…`);
      const res = await fetch("/api/locations/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: c.address, city: c.city, state: c.state, market: c.market, retries: true }) });
      const body = await res.json().catch(() => ({}));
      const l = body.location;
      const patch: Partial<Card> = l
        ? { location: { latitude: l.latitude, longitude: l.longitude, precision: l.geocode_precision }, locationNote: body.note ?? body.matchedAddress ?? null, needsFix: false }
        : { location: null, locationNote: body.reason ?? body.error ?? "Google couldn't place it", needsFix: true };
      out = out.map((x) => (x.key === c.key ? { ...x, ...patch } : x));
      update(c.key, patch);
    }
    return out;
  }

  async function create() {
    setError("");
    try {
      const unsure = unresolvedBrokers(brokers);
      if (unsure.length) throw new Error(`Confirm who ${unsure.join(" and ")} is under Broker: pick the existing contact or add them as new.`);
      const checked = await locate(cards);
      const ready = checked.filter((c) => c.include && c.location && !c.result?.dealId && !c.result?.duplicate);
      const unfixed = checked.filter((c) => c.include && !c.location && !c.result?.dealId).length;
      if (!ready.length) throw new Error(unfixed ? "Google couldn't place the ticked properties. Correct the address (add the city and state) and try again." : "Nothing ticked to create.");
      const sellerBrokers = brokers.length ? ((await call("/api/contacts/brokers", { entries: brokerEntriesOf(brokers) })).contactIds as string[]).map((contactId) => ({ contactId })) : [];
      for (let i = 0; i < ready.length; i++) {
        const c = ready[i], f = c.draft.fields;
        setStep(`Creating deal ${i + 1} of ${ready.length}: ${c.address}…`);
        try {
          const made = await call("/api/deals", {
            intakeKey: crypto.randomUUID(),
            address: c.address, city: c.city ?? undefined, state: c.state ?? undefined, market: c.market ?? c.city ?? undefined,
            latitude: c.location!.latitude, longitude: c.location!.longitude, geocodePrecision: c.location!.precision,
            assetClass: c.assetClass, assetType: c.assetClass,
            acres: c.acres ?? undefined, buildingSf: c.buildingSf ?? undefined,
            askingPrice: c.askingPrice != null ? String(c.askingPrice) : undefined,
            occupancyStatus: f.occupancy ?? undefined,
            waltYears: f.occupancy === "occupied" ? f.waltYears ?? undefined : undefined,
            tenancy: f.tenancy ?? undefined,
            marketingStatus: f.marketingStatus ?? undefined, acquisitionType: f.acquisitionType ?? "standard",
            sellerBrokers, currentOwnerName: f.currentOwner ?? undefined,
            ...(f.callForOffersOn ? { callForOffersOn: f.callForOffersOn, deadlineSourceDate: f.deadlineSourceDate, deadlineSourceQuote: f.deadlineSourceQuote } : {}),
          });
          const dealId = made.deal?.id as string;
          // What the broker said about this property, as a note on the deal. Never fatal.
          const lines = [f.brokerNotes, ...c.draft.notes].filter(Boolean);
          if (lines.length) await call("/api/activities", { activityType: "note", dealId, subject: `From ${source}`, body: lines.join("\n\n") }).catch(() => {});
          if (file) await call(`/api/deals/${dealId}/documents`, { importPath: file.path, fileName: file.name }).catch(() => {});
          update(c.key, { result: { dealId } });
        } catch (e: any) {
          const dup = e.status === 409 ? e.body?.duplicates?.[0] : null;
          update(c.key, { result: dup ? { duplicate: { id: dup.id, address: dup.address } } : { error: e.message } });
        }
      }
      if (unfixed) setError(`${unfixed} ticked propert${unfixed === 1 ? "y" : "ies"} couldn't be placed on the map and ${unfixed === 1 ? "wasn't" : "weren't"} created. Correct the address and click Create again.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStep("");
    }
  }

  const pending = cards.filter((c) => c.include && !c.result?.dealId && !c.result?.duplicate);
  const made = cards.filter((c) => c.result?.dealId);

  return (
    <section className="card" style={{ marginBottom: 20 }} aria-label="Several properties">
      <div className="card-head">
        <span className="overline">{cards.length} separate properties in {source}</span>
      </div>
      <p className="hint" style={{ margin: "0 0 12px" }}>
        Each becomes its own deal. Check the figures, untick any you don&apos;t want, and create them together. The broker&apos;s comments on each property are saved as a note on its deal.
      </p>

      <label className="multi-deal-broker">
        <span>Broker (linked to every deal)</span>
        <BrokerPicker value={brokers} onChange={setBrokers} initialText={first?.sellerBroker} initialPeople={first?.sellerBrokers} placeholder="Broker who sent this" disabled={busy} />
      </label>

      <div className="multi-deal-grid">
        {cards.map((c, i) => {
          const f = c.draft.fields;
          const done = c.result?.dealId;
          return (
            <article key={c.key} className={c.include ? "multi-deal-card" : "multi-deal-card off"}>
              <header>
                <label className="multi-deal-tick">
                  <input type="checkbox" checked={c.include} disabled={!!done || busy} onChange={(e) => update(c.key, { include: e.target.checked })} />
                  <span>Property {i + 1}</span>
                </label>
                {done ? <a href={`/deals/${done}`} className="badge2 success">Created · open</a>
                  : c.result?.duplicate ? <a href={`/deals/${c.result.duplicate.id}`} className="badge2 warning">Already in Hopper · open</a>
                  : c.result?.error ? <span className="badge2 danger">Failed</span> : null}
              </header>
              <div className="multi-deal-fields">
                <label className="wide">Address<input value={c.address} disabled={!!done || busy} onChange={(e) => update(c.key, { address: e.target.value, location: null, needsFix: false })} /></label>
                <label>City<input value={c.city ?? ""} disabled={!!done || busy} onChange={(e) => update(c.key, { city: e.target.value || null, location: null, needsFix: false })} /></label>
                <label>State<input value={c.state ?? ""} maxLength={2} disabled={!!done || busy} onChange={(e) => update(c.key, { state: e.target.value.toUpperCase() || null, location: null, needsFix: false })} /></label>
                <label>Market<input value={c.market ?? ""} disabled={!!done || busy} onChange={(e) => update(c.key, { market: e.target.value || null })} /></label>
                <label>Acres<input inputMode="decimal" value={c.acres ?? ""} disabled={!!done || busy} onChange={(e) => update(c.key, { acres: e.target.value === "" ? null : Number(e.target.value) || null })} /></label>
                <label>Building SF<input inputMode="numeric" value={c.buildingSf ?? ""} disabled={!!done || busy} onChange={(e) => update(c.key, { buildingSf: e.target.value === "" ? null : Number(e.target.value.replace(/,/g, "")) || null })} /></label>
                <label>Asking / guidance<input inputMode="numeric" value={c.askingPrice ?? ""} placeholder="—" disabled={!!done || busy} onChange={(e) => update(c.key, { askingPrice: e.target.value === "" ? null : Number(e.target.value.replace(/[$,]/g, "")) || null })} /></label>
                <label>Type
                  <select value={c.assetClass} disabled={!!done || busy} onChange={(e) => update(c.key, { assetClass: e.target.value as "ios" | "industrial" })}>
                    <option value="ios">IOS</option>
                    <option value="industrial">Industrial</option>
                  </select>
                </label>
              </div>
              <p className="multi-deal-facts">
                {[c.askingPrice != null ? money(c.askingPrice) : null, f.occupancy ? (f.occupancy === "occupied" ? "Occupied" : "Vacant") : null, f.marketingStatus === "off_market" ? "Off-market" : f.marketingStatus === "marketed" ? "Marketed" : null, f.currentOwner ? `Owner: ${f.currentOwner}` : null].filter(Boolean).join(" · ")}
              </p>
              {f.brokerNotes ? <p className="multi-deal-notes">{f.brokerNotes}</p> : null}
              {c.draft.notes.length ? <ul className="multi-deal-flags">{c.draft.notes.map((n, j) => <li key={j}>{n}</li>)}</ul> : null}
              {c.locationNote ? <p className={c.needsFix ? "error" : "hint"} style={{ margin: 0 }}>{c.needsFix ? `Not placed: ${c.locationNote}` : `Located: ${c.locationNote}`}</p> : null}
              {c.result?.error ? <p className="error" style={{ margin: 0 }}>{c.result.error}</p> : null}
            </article>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
        <button type="button" onClick={create} disabled={busy || !pending.length}>
          {busy ? "Working…" : `Create ${pending.length} deal${pending.length === 1 ? "" : "s"}`}
        </button>
        {step ? <span className="hint" style={{ margin: 0 }}>{step}</span> : null}
        {made.length ? <span className="hint" style={{ margin: 0 }}>{made.length} created. <a href="/deals">Open the board</a></span> : null}
      </div>
      {error ? <p className="error" style={{ marginBottom: 0 }}>{error}</p> : null}
    </section>
  );
}
