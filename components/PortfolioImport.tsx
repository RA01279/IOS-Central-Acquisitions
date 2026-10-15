"use client";
// components/PortfolioImport.tsx
//
// New Deal > Portfolio OM: one OM offering many sites. The whole OM is read
// in the browser, sent to the portfolio-import agent a section at a time (a
// national OM is longer than one agent call can read), and the sites are
// merged into a review table. Each ticked, located site becomes its own deal,
// flagged as part of one portfolio, with the OM filed once and attached to
// every site. Nothing is created until the person clicks Create.

import { useEffect, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { pdfText } from "@/lib/pdf-text";
import { mergePortfolioImports, parsePortfolioImport, splitOmText, type PortfolioImport as Draft, type PortfolioSite } from "@/lib/agents/portfolio-import";

type Row = PortfolioSite & {
  key: string;
  include: boolean;
  location: { latitude: number; longitude: number; precision: string } | null;
  locationNote: string | null;
  result: { dealId?: string; error?: string; duplicate?: { id: string; address: string } } | null;
};

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status, body });
  return body;
}
const post = (url: string, body: unknown) =>
  json(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const money = (v: number | null) => (v == null ? "" : `$${Math.round(v).toLocaleString("en-US")}`);

export default function PortfolioImport() {
  const [agentsOnline, setAgentsOnline] = useState<boolean | null>(null);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  const [meta, setMeta] = useState<Draft["portfolio"] & { notes: string[] }>({ name: null, sellerBroker: null, currentOwner: null, totalPrice: null, notes: [] });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
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
      if (alive.current) setError(e?.message ?? "Portfolio import failed");
    } finally {
      if (alive.current) setStep("");
    }
  }

  /** One section through the portfolio-import agent. */
  async function readSection(text: string, label: string): Promise<Draft> {
    const { id } = await post("/api/agents", { agent: "portfolio-import", text });
    const deadline = Date.now() + 10 * 60000;
    while (alive.current && Date.now() < deadline) {
      await sleep(3000);
      const r = await json(`/api/agents?id=${id}`);
      if (r.status === "failed") throw new Error(`${label}: ${r.error || "the helper could not read it."}`);
      if (r.status === "completed") {
        const parsed = parsePortfolioImport(r.result?.report ?? "");
        if (!parsed) throw new Error(`${label}: no property schedule came back.`);
        return parsed;
      }
    }
    throw new Error("The helper is taking too long. Check it is still running on your computer.");
  }

  async function fromFile(f: File) {
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) throw new Error("Choose a PDF.");
    if (f.size > 40 * 1024 * 1024) throw new Error("That PDF is over 40 MB.");
    setRows(null);
    setPortfolioId(null);
    setStep("Reading the whole OM…");
    const buf = await f.arrayBuffer();
    const pdf = await pdfText(buf, 900000, 400);
    if (pdf.scanned) throw new Error("This PDF is a scan with no text layer, so it can't be read.");
    setStep("Uploading the OM…");
    const slot = await post("/api/imports", { action: "upload_url" });
    const { error: upErr } = await getSupabaseBrowserClient().storage.from("documents").uploadToSignedUrl(slot.path, slot.token, f, { contentType: "application/pdf" });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
    setFile({ path: slot.path, name: f.name });

    const sections = splitOmText(pdf.text);
    const parts: Draft[] = [];
    const failures: string[] = [];
    for (let i = 0; i < sections.length; i++) {
      const first = sections[i].match(/\[Page (\d+)\]/)?.[1];
      const last = [...sections[i].matchAll(/\[Page (\d+)\]/g)].pop()?.[1];
      const label = `Pages ${first ?? "?"}–${last ?? "?"}`;
      setStep(`Reading the property schedule, section ${i + 1} of ${sections.length} (${label})… about a minute each`);
      const head = `PORTFOLIO OM (${f.name}), ${pdf.pages} pages; this section is ${label}:\n`;
      try {
        parts.push(await readSection(head + sections[i], label));
      } catch (e: any) {
        failures.push(e.message);
      }
    }
    if (!parts.length) throw new Error(failures.join(" ") || "No sites found.");
    const merged = mergePortfolioImports(parts);
    if (!merged.sites.length) throw new Error("No property sites found in that OM.");
    setMeta({ ...merged.portfolio, name: merged.portfolio.name ?? f.name.replace(/\.pdf$/i, ""), notes: [...failures.map((m) => `Not read: ${m}`), ...merged.notes] });
    setRows(merged.sites.map((s, i) => ({ ...s, key: `${i}`, include: true, location: null, locationNote: null, result: null })));
  }

  const update = (key: string, patch: Partial<Row>) => setRows((prev) => prev?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);

  async function checkLocations() {
    const todo = (rows ?? []).filter((r) => r.include && !r.location && !r.result?.dealId);
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      setStep(`Checking locations with Google, ${i + 1} of ${todo.length}…`);
      const res = await fetch("/api/locations/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: r.address, city: r.city, state: r.state, market: r.market }) });
      const body = await res.json().catch(() => ({}));
      const l = body.location;
      update(r.key, l
        ? { location: { latitude: l.latitude, longitude: l.longitude, precision: l.geocode_precision }, locationNote: body.matchedAddress ?? null }
        : { location: null, locationNote: body.message ?? body.error ?? "Couldn't verify" });
    }
  }

  async function create() {
    const ready = (rows ?? []).filter((r) => r.include && r.location && !r.result?.dealId);
    if (!ready.length) throw new Error("No ticked sites with a verified location. Check locations first.");
    if (!meta.name?.trim()) throw new Error("Name the portfolio.");
    let pid = portfolioId;
    if (!pid) {
      setStep("Creating the portfolio…");
      const made = await post("/api/deal-portfolios", { name: meta.name, sellerBroker: meta.sellerBroker, currentOwner: meta.currentOwner, notes: meta.notes, importPath: file?.path, fileName: file?.name });
      pid = made.id as string;
      setPortfolioId(pid);
      if (made.omWarning) setError(made.omWarning);
    }
    for (let i = 0; i < ready.length; i++) {
      const r = ready[i];
      setStep(`Creating site ${i + 1} of ${ready.length}: ${r.address}…`);
      try {
        const assetClass = r.assetClass ?? "ios";
        const made = await post("/api/deals", {
          intakeKey: crypto.randomUUID(),
          dealPortfolioId: pid,
          address: r.address, city: r.city ?? undefined, state: r.state ?? undefined, market: r.market ?? r.city ?? undefined,
          latitude: r.location!.latitude, longitude: r.location!.longitude, geocodePrecision: r.location!.precision,
          assetClass, assetType: assetClass,
          acres: r.acres ?? undefined, buildingSf: r.buildingSf ?? undefined,
          askingPrice: r.askingPrice != null ? String(r.askingPrice) : undefined,
          occupancyStatus: r.occupancy ?? undefined,
          waltYears: r.occupancy === "occupied" ? r.waltYears ?? undefined : undefined,
          tenancy: r.tenancy ?? undefined,
          marketingStatus: "marketed", acquisitionType: "standard",
          sellerBrokerName: meta.sellerBroker ?? undefined, currentOwnerName: meta.currentOwner ?? undefined,
        });
        const dealId = made.deal?.id as string;
        if (file) await post(`/api/deals/${dealId}/documents`, { portfolioId: pid }).catch(() => {});
        update(r.key, { result: { dealId } });
      } catch (e: any) {
        const dup = e.status === 409 ? e.body?.duplicates?.[0] : null;
        update(r.key, { result: dup ? { duplicate: { id: dup.id, address: dup.address } } : { error: e.message } });
      }
    }
  }

  const included = rows?.filter((r) => r.include) ?? [];
  const located = included.filter((r) => r.location);
  const created = rows?.filter((r) => r.result?.dealId).length ?? 0;
  const priced = included.reduce((s, r) => s + (r.askingPrice ?? 0), 0);

  return (
    <section className="card" style={{ marginBottom: 20 }} aria-label="Import a portfolio">
      <div className="card-head"><span className="overline">Portfolio OM — one deal per site</span></div>
      <p className="hint" style={{ margin: 0 }}>
        Hopper reads every page, lists each site with its allocated price, and creates one deal per site, flagged as one
        portfolio. Nothing is created until you click Create.
      </p>
      {agentsOnline === false && (
        <p className="warning" style={{ margin: 0 }}>The Hopper helper isn&apos;t running on your computer. Start it from the desktop launcher.</p>
      )}

      {!rows && (
        <label
          className="om-drop"
          data-drag={drag || undefined}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
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
          <span><strong>Drop the portfolio OM here</strong> or click to choose a PDF</span>
          <input type="file" accept="application/pdf,.pdf" disabled={busy || !agentsOnline} style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void run(() => fromFile(f)); }} />
        </label>
      )}

      {rows && (
        <>
          <div className="grid-2">
            <label>Portfolio name<input value={meta.name ?? ""} disabled={!!portfolioId} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></label>
            <label>Sales broker<input value={meta.sellerBroker ?? ""} disabled={!!portfolioId} onChange={(e) => setMeta({ ...meta, sellerBroker: e.target.value || null })} /></label>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            {rows.length} sites found · {included.length} ticked · {located.length} located · allocated {money(priced) || "$0"}
            {meta.totalPrice ? ` of ${money(meta.totalPrice)} package price` : ""}
            {meta.totalPrice && priced && Math.abs(priced - meta.totalPrice) > meta.totalPrice * 0.01 ? " — allocations don't add up to the package price; check them" : ""}
          </p>
          {meta.notes.length > 0 && (
            <ul className="warning" style={{ margin: 0, paddingLeft: 28 }}>{meta.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          )}
          <div style={{ overflowX: "auto" }}>
            <table className="summary-table">
              <thead>
                <tr><th></th><th>Address</th><th>City</th><th>St</th><th>Market</th><th>Acres</th><th>Bldg SF</th><th>Allocated price</th><th>Class</th><th>Tenant</th><th>Pg</th><th>Location / result</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const done = !!r.result?.dealId;
                  const cell = (k: "address" | "city" | "state" | "market", w: number) => (
                    <input value={r[k] ?? ""} disabled={done || busy} style={{ width: w }}
                      onChange={(e) => update(r.key, { [k]: e.target.value || (k === "address" ? "" : null), location: null, locationNote: null } as Partial<Row>)} />
                  );
                  const numCell = (k: "acres" | "buildingSf" | "askingPrice", w: number) => (
                    <input value={r[k] ?? ""} inputMode="decimal" disabled={done || busy} style={{ width: w }}
                      onChange={(e) => { const v = e.target.value.replace(/[$,\s]/g, ""); update(r.key, { [k]: v === "" || !Number.isFinite(Number(v)) ? null : Number(v) } as Partial<Row>); }} />
                  );
                  return (
                    <tr key={r.key} style={r.include ? undefined : { opacity: 0.5 }}>
                      <td><input type="checkbox" checked={r.include} disabled={done || busy} onChange={(e) => update(r.key, { include: e.target.checked })} /></td>
                      <td>{cell("address", 180)}</td>
                      <td>{cell("city", 110)}</td>
                      <td>{cell("state", 36)}</td>
                      <td>{cell("market", 110)}</td>
                      <td>{numCell("acres", 64)}</td>
                      <td>{numCell("buildingSf", 80)}</td>
                      <td>{numCell("askingPrice", 110)}</td>
                      <td>
                        <select value={r.assetClass ?? "ios"} disabled={done || busy} onChange={(e) => update(r.key, { assetClass: e.target.value as "ios" | "industrial" })}>
                          <option value="ios">IOS</option><option value="industrial">Industrial</option>
                        </select>
                      </td>
                      <td>{r.tenant ?? ""}</td>
                      <td>{r.page ?? ""}</td>
                      <td style={{ minWidth: 180 }}>
                        {r.result?.dealId ? <a href={`/deals/${r.result.dealId}`}>Created ✓</a>
                          : r.result?.duplicate ? <a href={`/deals/${r.result.duplicate.id}`}>Already a deal — open it</a>
                          : r.result?.error ? <span className="error">{r.result.error}</span>
                          : r.location ? <span className="hint" style={{ margin: 0 }}>✓ {r.locationNote}</span>
                          : r.locationNote ? <span className="error">{r.locationNote}</span>
                          : <span className="muted">Not checked</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="secondary" disabled={busy} onClick={() => void run(checkLocations)}>Check locations with Google</button>
            <button type="button" disabled={busy || !located.filter((r) => !r.result?.dealId).length} onClick={() => void run(create)}>
              Create {located.filter((r) => !r.result?.dealId).length} deals
            </button>
            {portfolioId && <a href={`/deals/portfolios/${portfolioId}`}>Open the portfolio ({created} sites) →</a>}
            {!portfolioId && <button type="button" className="secondary" disabled={busy} onClick={() => { setRows(null); setFile(null); }}>Start over</button>}
          </div>
          <p className="hint" style={{ margin: 0 }}>
            Sites Google can&apos;t verify aren&apos;t created; fix the address and check again, or create that one from the
            single-property form later. Untick anything that isn&apos;t part of the offering.
          </p>
        </>
      )}

      {step && (
        <p role="status" className="hint" style={{ margin: 0, color: "#0E5AA7" }}>
          <span className="spin" style={{ display: "inline-block", marginRight: 6 }}>◌</span>{step}
        </p>
      )}
      {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </section>
  );
}
