"use client";

// Off-market sourcing: sweep a submarket for businesses operating from outdoor
// yards, pick the sites worth chasing, have the agent find the owner of record
// and draft outreach, then add the good ones to the pipeline as prospects.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import MapView, { type MapPoint } from "./MapView";
import { MARKETS, DEFAULT_BUY_BOX, type BuyBox } from "@/lib/sourcing/markets";
import { MAX_SOURCING_SITES, parseSourcing, type SourcedSite } from "@/lib/agents/sourcing";
import type { Site } from "@/lib/sourcing/sweep";
import { SOURCING_PROFILES, selectedProfiles } from "@/lib/sourcing/profiles";
import SourcingProfilePicker from "./SourcingProfilePicker";

type Sweep = { center: { lat: number; lng: number }; label: string; radiusMiles: number; sites: Site[]; screened: number; failedSearches: number; note: string; criteriaKey?: string; profileIds?: string[]; searches?: { profileId: string; profile: string; keyword: string; failed: boolean; returned: number; limited: boolean }[]; contacts?: { requested: number; failed: number } };
type Saved = { market: string; buyBox: BuyBox; sites: Site[] };
type RunInfo = { id: string; status: string; error?: string | null; created_at?: string };

const STORE = "hopper-sourcing:";
const save = (id: string, v: Saved) => { try { localStorage.setItem(STORE + id, JSON.stringify(v)); } catch { /* storage unavailable */ } };
const load = (id: string): Saved | null => { try { const v = localStorage.getItem(STORE + id); return v ? JSON.parse(v) : null; } catch { return null; } };
const FIT_COLOR: Record<string, string> = { strong: "#1E7A46", possible: "#B4801A", poor: "#A32626", unknown: "#66717E" };

/** Source strings carry a URL somewhere in them; link that, show the rest as text. */
function SourceLine({ text }: { text: string }) {
  const m = text.match(/https?:\/\/[^\s)]+/);
  if (!m) return <>{text}</>;
  const [before, after] = [text.slice(0, m.index), text.slice(m.index! + m[0].length)];
  return <>{before}<a href={m[0]} target="_blank" rel="noopener noreferrer">{m[0].replace(/^https?:\/\//, "").slice(0, 60)}</a>{after}</>;
}

export default function SourcingWorkspace({ viewerKey }: { viewerKey: string }) {
  const [profileIds, setProfileIds] = useState<string[]>(SOURCING_PROFILES.map((p) => p.id));
  const [restored, setRestored] = useState(false);
  const sweepRequest = useRef<{ version: number; controller?: AbortController }>({ version: 0 });
  const [marketKey, setMarketKey] = useState(MARKETS[0].key);
  const [submarketKey, setSubmarketKey] = useState(MARKETS[0].submarkets[0].key);
  const [mode, setMode] = useState<"submarket" | "address">("submarket");
  const [address, setAddress] = useState("");
  const [radius, setRadius] = useState(3);
  const [buyBox, setBuyBox] = useState<BuyBox>(DEFAULT_BUY_BOX);
  const [sweep, setSweep] = useState<Sweep | null>(null);
  const [showKnown, setShowKnown] = useState(false);
  const [hidePublic, setHidePublic] = useState(true);
  const [inBoxOnly, setInBoxOnly] = useState(false);
  const [ownerUsersFirst, setOwnerUsersFirst] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<"sweep" | "agent" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [recent, setRecent] = useState<RunInfo[]>([]);
  const [run, setRun] = useState<RunInfo | null>(null);
  const [report, setReport] = useState<{ sites: SourcedSite[]; saved: Saved } | null>(null);
  const [added, setAdded] = useState<Record<string, { dealId?: string; error?: string; busy?: boolean }>>({});
  const market = MARKETS.find((m) => m.key === marketKey)!;
  const criteriaKey = JSON.stringify({ profileIds: [...profileIds].sort(), mode, geography: mode === "submarket" ? submarketKey : address.trim(), radius });

  // Keep the reviewed dataset and controls together across property navigation.
  // Session storage is scoped to the signed-in viewer and this browser tab.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(`sourcing-results-v2:${viewerKey}`) ?? "null");
      if (saved) {
        if (Array.isArray(saved.profileIds) && (!saved.profileIds.length || selectedProfiles(saved.profileIds))) setProfileIds(saved.profileIds);
        if (MARKETS.some((m) => m.key === saved.marketKey && m.submarkets.some((s) => s.key === saved.submarketKey))) { setMarketKey(saved.marketKey); setSubmarketKey(saved.submarketKey); }
        if (["submarket", "address"].includes(saved.mode)) setMode(saved.mode);
        if (typeof saved.address === "string") setAddress(saved.address);
        if ([1, 2, 3, 5, 7, 10].includes(saved.radius)) setRadius(saved.radius);
        if (saved.buyBox) setBuyBox(saved.buyBox);
        if (saved.sweep?.sites) setSweep(saved.sweep);
        for (const [key, setter] of [["showKnown", setShowKnown], ["hidePublic", setHidePublic], ["inBoxOnly", setInBoxOnly], ["ownerUsersFirst", setOwnerUsersFirst]] as const) if (typeof saved[key] === "boolean") setter(saved[key]);
        if (Array.isArray(saved.selected)) setSelected(saved.selected);
        if (saved.report) setReport(saved.report);
        if (saved.run?.id && saved.run?.status) setRun(saved.run);
        if (saved.added) setAdded(saved.added);
      }
    } catch { /* storage may be unavailable */ }
    setRestored(true);
    return () => { sweepRequest.current.controller?.abort(); sweepRequest.current.version++; };
  }, [viewerKey]);
  useEffect(() => {
    if (!restored) return;
    try { sessionStorage.setItem(`sourcing-results-v2:${viewerKey}`, JSON.stringify({ profileIds, marketKey, submarketKey, mode, address, radius, buyBox, sweep, showKnown, hidePublic, inBoxOnly, ownerUsersFirst, selected, report, run, added })); } catch { /* quota or storage unavailable */ }
  }, [restored, viewerKey, profileIds, marketKey, submarketKey, mode, address, radius, buyBox, sweep, showKnown, hidePublic, inBoxOnly, ownerUsersFirst, selected, report, run, added]);

  function cancelPendingSweep() {
    sweepRequest.current.version++;
    sweepRequest.current.controller?.abort();
    if (busy === "sweep") setBusy(null);
  }

  // Helper status and recent sourcing runs.
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const r = await fetch("/api/agents", { cache: "no-store" });
        const d = await r.json();
        if (!live || !r.ok) return;
        setOnline(d.online);
        setRecent((d.runs ?? []).filter((x: any) => x.agent === "off-market-sourcing").slice(0, 8));
      } catch { if (live) setOnline(false); }
    };
    void refresh();
    const t = setInterval(refresh, 15000);
    return () => { live = false; clearInterval(t); };
  }, []);

  // Poll the open run until it finishes, then parse its report.
  useEffect(() => {
    if (!run) return;
    let live = true;
    const refresh = async () => {
      try {
        const r = await fetch(`/api/agents?id=${encodeURIComponent(run.id)}`, { cache: "no-store" });
        const d = await r.json();
        if (!live || !r.ok) return;
        if (d.status !== run.status) setRun({ id: run.id, status: d.status, error: d.error });
        if (d.status === "completed" && d.result?.report) {
          const saved = load(run.id);
          const parsed = parseSourcing(d.result.report);
          if (!saved) setError("This report's sweep isn't saved in this browser, so its sites can't be mapped or added. Run a new sweep.");
          else if (!parsed) setError("The report couldn't be read.");
          else setReport({ sites: parsed.sites, saved });
        }
      } catch { /* retry on next tick */ }
    };
    void refresh();
    const t = setInterval(() => { if (["queued", "processing"].includes(run.status)) void refresh(); }, 5000);
    return () => { live = false; clearInterval(t); };
  }, [run?.id, run?.status]);

  async function runSweep() {
    if (!profileIds.length) { setError("Select at least one business / occupier profile."); return; }
    cancelPendingSweep();
    const version = sweepRequest.current.version;
    const controller = new AbortController();
    sweepRequest.current.controller = controller;
    setBusy("sweep"); setError(null); setRun(null);
    try {
      const r = await fetch("/api/sourcing/sweep", { method: "POST", headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ ...(mode === "submarket" ? { submarket: submarketKey } : { address }), radiusMiles: radius, profileIds }) });
      const d = await r.json();
      if (version !== sweepRequest.current.version) return;
      if (!r.ok) throw new Error(d.error ?? "Sweep failed.");
      setSweep({ ...d, criteriaKey }); setSelected([]); setReport(null); setAdded({});
    } catch (e: any) { if (version === sweepRequest.current.version && e.name !== "AbortError") setError(e.message); }
    finally { if (version === sweepRequest.current.version) setBusy(null); }
  }

  async function qualify() {
    if (!sweep) return;
    const sites = sweep.sites.filter((s) => selected.includes(s.ref));
    setBusy("agent"); setError(null); setReport(null); setAdded({});
    try {
      const text = JSON.stringify({ market: market.label, buyBox, sites: sites.map((s) => ({ ref: s.ref, address: s.address, lat: s.lat, lng: s.lng, ownerUser: s.ownerUser, operators: s.operators.map((o) => ({ name: o.name, category: o.category })), parcel: s.parcel })) });
      const r = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent: "off-market-sourcing", text }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not start the agent.");
      save(d.id, { market: market.label, buyBox, sites });
      setRun({ id: d.id, status: "queued" });
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  async function addProspect(s: SourcedSite) {
    if (!run || !report) return;
    const site = report.saved.sites.find((x) => x.ref === s.ref);
    if (!site) return;
    setAdded((a) => ({ ...a, [s.ref]: { busy: true } }));
    try {
      const r = await fetch("/api/sourcing/prospect", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id, ref: s.ref, market: report.saved.market, site: { lat: site.lat, lng: site.lng, address: site.address, operators: site.operators.map((o) => o.name) } }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not add the prospect.");
      setAdded((a) => ({ ...a, [s.ref]: { dealId: d.dealId } }));
    } catch (e: any) { setAdded((a) => ({ ...a, [s.ref]: { error: e.message } })); }
  }

  async function exportSites(sites: Site[], label: string, research?: SourcedSite[]) {
    if (!sites.length || exporting) return;
    setExporting(true); setExportError(null);
    try {
      const { downloadSourcingWorkbook } = await import("@/lib/sourcing/export");
      await downloadSourcingWorkbook(sites, label, research);
    } catch {
      setExportError("Could not export the workbook. Please try again.");
    } finally { setExporting(false); }
  }

  const inBox = (s: Site) => s.parcel?.acres != null && s.parcel.acres >= buyBox.minAcres && s.parcel.acres <= buyBox.maxAcres;
  const visible = useMemo(() => {
    const list = (sweep?.sites ?? []).filter((s) => (showKnown || !s.known) && (!hidePublic || s.parcel?.ownerClass !== "public") && (!inBoxOnly || inBox(s)));
    return ownerUsersFirst ? [...list].sort((a, b) => Number(b.ownerUser) - Number(a.ownerUser)) : list;
  }, [sweep, showKnown, hidePublic, inBoxOnly, ownerUsersFirst, buyBox]);
  const publicCount = (sweep?.sites ?? []).filter((s) => s.parcel?.ownerClass === "public").length;
  const knownCount = (sweep?.sites ?? []).filter((s) => s.known).length;
  const points: MapPoint[] = useMemo(() => {
    const src = report ? report.saved.sites.filter((s) => report.sites.some((r) => r.ref === s.ref)) : visible;
    const fit = new Map(report?.sites.map((s) => [s.ref, s.fit]) ?? []);
    return [
      ...(sweep && !report ? [{ id: "center", lat: sweep.center.lat, lng: sweep.center.lng, color: "132B46", title: sweep.label, lines: [`${sweep.radiusMiles} mi sweep centre`], emphasis: true }] : []),
      ...src.map((s) => ({
        id: s.ref, lat: s.lat, lng: s.lng,
        color: s.known ? "9AA3AD" : report ? (FIT_COLOR[fit.get(s.ref) ?? "unknown"] ?? "#66717E").slice(1) : selected.includes(s.ref) ? "D35400" : "2E6DA4",
        title: `${s.ref} · ${s.operators.map((o) => o.name).join(", ")}`.slice(0, 120),
        lines: [s.address, s.categories.join(", "), s.known ? `In Hopper: ${s.known.label}` : `${s.distanceMi.toFixed(1)} mi from centre`],
        href: s.known?.href,
      })),
    ];
  }, [sweep, visible, selected, report]);

  const toggle = (ref: string) => setSelected((cur) => cur.includes(ref) ? cur.filter((r) => r !== ref) : cur.length >= MAX_SOURCING_SITES ? cur : [...cur, ref]);

  return (
    <>
      <h1>Off-market sourcing</h1>
      <p className="hint">Businesses that run outdoor yards — trucking, equipment rental, contractors, container storage, building materials — are sitting on IOS sites, listed or not. Sweep a submarket and Hopper pulls each site's owner of record from the county appraisal roll. Pick the sites worth chasing and the agent researches the owner, confirms occupancy and zoning, and drafts outreach. Nothing is sent; you add the good ones to the pipeline.</p>

      <section className="panel">
        <h2>1. Sweep</h2>
        <form onSubmit={(e) => { e.preventDefault(); void runSweep(); }}>
        <SourcingProfilePicker selected={profileIds} onChange={(ids) => { cancelPendingSweep(); setProfileIds(ids); }} />
        <div onChangeCapture={cancelPendingSweep}>
        <div className="grid-2">
          <label>Search around
            <select value={mode} onChange={(e) => setMode(e.target.value as any)}>
              <option value="submarket">A submarket</option>
              <option value="address">An address or intersection</option>
            </select>
          </label>
          <label>Radius
            <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
              {[1, 2, 3, 5, 7, 10].map((r) => <option key={r} value={r}>{r} miles</option>)}
            </select>
          </label>
        </div>
        {mode === "submarket" ? (
          <div className="grid-2">
            <label>Market
              <select value={marketKey} onChange={(e) => { const m = MARKETS.find((x) => x.key === e.target.value)!; setMarketKey(m.key); setSubmarketKey(m.submarkets[0].key); }}>
                {MARKETS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
            <label>Submarket
              <select value={submarketKey} onChange={(e) => setSubmarketKey(e.target.value)}>
                {market.submarkets.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          </div>
        ) : (
          <label>Address or intersection
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. Aldine Bender Rd & JFK Blvd, Houston, TX" />
          </label>
        )}
        <fieldset className="grid-2" style={{ border: 0, padding: 0 }}>
          <legend className="hint">Buy box (the agent checks each site against it)</legend>
          <label>Usable acres, min<input type="number" min={0} step={0.5} value={buyBox.minAcres} onChange={(e) => setBuyBox({ ...buyBox, minAcres: Number(e.target.value) })} /></label>
          <label>Usable acres, max<input type="number" min={0} step={0.5} value={buyBox.maxAcres} onChange={(e) => setBuyBox({ ...buyBox, maxAcres: Number(e.target.value) })} /></label>
          <label>Max building coverage %<input type="number" min={0} max={100} step={5} value={buyBox.maxCoveragePct} onChange={(e) => setBuyBox({ ...buyBox, maxCoveragePct: Number(e.target.value) })} /></label>
        </fieldset>
        </div>
        <button type="submit" disabled={!restored || !profileIds.length || busy !== null || (mode === "address" && !address.trim())}>{busy === "sweep" ? "Sweeping… (about 20 seconds)" : "Sweep"}</button>
        {!profileIds.length && <p className="hint">Select at least one profile to run Google sourcing.</p>}
        {error && <p role="alert" className="error">{error}</p>}
        </form>
      </section>

      {(sweep || report) && (
        <section className="panel">
          <h2>{report ? "3. Qualified sites" : "2. Pick sites to qualify"}</h2>
          {sweep && !report && <>
            <p><strong>Reviewed search:</strong> {sweep.label}, {sweep.radiusMiles} miles. Profiles: {SOURCING_PROFILES.filter((p) => sweep.profileIds?.includes(p.id)).map((p) => p.label).join(", ") || "All existing yard-use profiles (previous sweep)"}. <strong>{visible.length} filtered properties</strong> / {sweep.sites.length} discovered properties. Map and filtered export use these same {visible.length} properties.</p>
            {sweep.criteriaKey && criteriaKey !== sweep.criteriaKey && <p role="status">Search criteria changed. Run Sweep to replace these results; the displayed list and export still reflect the reviewed search above.</p>}
            {sweep.searches && <details><summary>Google search coverage ({sweep.searches.filter((s) => !s.failed).length}/{sweep.searches.length} searches succeeded)</summary><ul>{sweep.searches.map((s) => <li key={`${s.profileId}:${s.keyword}`}>{s.profile}: {s.keyword} — {s.failed ? "failed; results incomplete" : `${s.returned} returned${s.limited ? "; first-page limit reached / additional results may exist" : ""}`}</li>)}</ul></details>}
            {!!sweep.contacts?.failed && <p role="status">Business contact lookup incomplete for {sweep.contacts.failed} of {sweep.contacts.requested} businesses. Unavailable phone and website fields remain blank.</p>}
          </>}
          {exportError && <p role="alert" className="error">{exportError}</p>}
          {exporting && <p role="status">Preparing Excel export...</p>}
          {sweep && !report && (
            <p className="hint">
              {sweep.label}: {sweep.sites.length - knownCount} new yard site{sweep.sites.length - knownCount === 1 ? "" : "s"}
              {knownCount > 0 && <> · {knownCount} already in Hopper (<button type="button" className="link-button" onClick={() => setShowKnown(!showKnown)}>{showKnown ? "hide" : "show"}</button>)</>}
              {publicCount > 0 && <> · {publicCount} publicly owned{hidePublic ? " (hidden)" : ""}</>}
              {" · "}{sweep.screened} listings screened out as non-yard uses{sweep.failedSearches ? ` · ${sweep.failedSearches} searches failed` : ""}. {sweep.note}
            </p>
          )}
          <MapView points={points} height={440} emptyMessage="No yard users found here. Try a wider radius or another submarket." />
          {sweep && !report && (
            <>
              <p style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <label><input type="checkbox" checked={hidePublic} onChange={(e) => setHidePublic(e.target.checked)} /> Hide publicly owned</label>
                <label><input type="checkbox" checked={inBoxOnly} onChange={(e) => setInBoxOnly(e.target.checked)} /> Only {buyBox.minAcres}–{buyBox.maxAcres} acres</label>
                <label><input type="checkbox" checked={ownerUsersFirst} onChange={(e) => setOwnerUsersFirst(e.target.checked)} /> Owner-users first</label>
              </p>
              <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button type="button" className="secondary" disabled={exporting || !selected.length} onClick={() => exportSites(sweep.sites.filter((s) => selected.includes(s.ref)), sweep.label)}>Export selected to Excel ({selected.length})</button>
                <button type="button" className="secondary" disabled={exporting || !visible.length} onClick={() => exportSites(visible, `${sweep.label} | ${sweep.radiusMiles} mi | Profiles: ${SOURCING_PROFILES.filter((p) => sweep.profileIds?.includes(p.id)).map((p) => p.label).join(", ") || "All profiles"} | ${sweep.failedSearches} failed searches | Google first-page sample`)}>Export filtered results to Excel ({visible.length})</button>
              </p>
              <div style={{ overflowX: "auto" }}>
                <table className="summary-table">
                  <thead><tr><th></th><th>Site</th><th>Operators</th><th>Owner of record</th><th>Acres</th><th>Built</th><th>Address</th><th>Distance</th><th>In Hopper</th></tr></thead>
                  <tbody>
                    {visible.map((s) => (
                      <tr key={s.ref} data-site-ref={s.ref}>
                        <td>{!s.known && <input type="checkbox" aria-label={`Select ${s.ref}`} checked={selected.includes(s.ref)} onChange={() => toggle(s.ref)} disabled={!selected.includes(s.ref) && selected.length >= MAX_SOURCING_SITES} />}</td>
                        <td>{s.ref}</td>
                        <td>{s.operators.map((o) => <div key={o.placeId} data-place-id={o.placeId} data-profile-ids={o.profileIds?.join(",")}><strong>{o.name}</strong><br /><span className="hint">Matched profiles: {(o.categories ?? [o.category]).join(", ")}</span><br />{o.phone && <>Business phone: {o.phone}<br /></>}{o.website && <><a href={o.website} target="_blank" rel="noopener noreferrer">Business website</a>{" · "}</>}<a href={o.googleUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.name)}&query_place_id=${encodeURIComponent(o.placeId)}`} target="_blank" rel="noopener noreferrer">Google business source</a></div>)}<span className="hint">Business contacts are not verified owner contacts.</span></td>
                        <td>{s.parcel?.owner ?? "—"}{s.ownerUser && <strong title="Owner name matches an operator: a sale-leaseback lead"> · owner-user</strong>}{s.parcel && s.parcel.ownerClass !== "private" && <span className="hint"> · {s.parcel.ownerClass}</span>}</td>
                        <td style={{ fontWeight: inBox(s) ? 600 : 400, color: s.parcel?.acres != null && !inBox(s) ? "#8a8f98" : undefined }}>{s.parcel?.acres ?? "—"}</td>
                        <td>{s.parcel?.yearBuilt ?? "—"}</td>
                        <td>{s.address}</td>
                        <td>{s.distanceMi.toFixed(1)} mi</td>
                        <td>{s.known ? <Link href={s.known.href}>{s.known.kind}</Link> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hint">Selected {selected.length} of {MAX_SOURCING_SITES}. {online === false && <>Your computer helper is offline — start it (Desktop: <em>Start Hopper helper</em>) to qualify sites.</>}</p>
              <button type="button" onClick={qualify} disabled={!selected.length || busy !== null || online === false}>{busy === "agent" ? "Starting…" : `Qualify ${selected.length || ""} site${selected.length === 1 ? "" : "s"} with the agent`}</button>
            </>
          )}
          {run && ["queued", "processing"].includes(run.status) && <p role="status">The agent is researching owners and parcels ({run.status}). About a minute per site; this page updates when it's done.</p>}
          {run?.status === "failed" && <p className="error">The agent run failed: {run.error ?? "unknown error"}</p>}
          {report && (
            <>
              <button type="button" className="secondary" disabled={exporting || !report.sites.length} onClick={() => exportSites(report.saved.sites.filter((s) => report.sites.some((r) => r.ref === s.ref)), report.saved.market, report.sites)}>Export qualified sites to Excel ({report.sites.length})</button>
              <p className="hint">Agent research from public records. Verify the owner and parcel against the appraisal district before reaching out. Buy box: {report.saved.buyBox.minAcres}–{report.saved.buyBox.maxAcres} usable acres, ≤{report.saved.buyBox.maxCoveragePct}% coverage. <button type="button" className="link-button" onClick={() => { setReport(null); setRun(null); }}>Back to sweep</button></p>
              {report.sites.map((s) => {
                const site = report.saved.sites.find((x) => x.ref === s.ref);
                const a = added[s.ref];
                return (
                  <article key={s.ref} className="panel-inset" style={{ marginBottom: 12 }}>
                    <h3 style={{ margin: 0 }}>{s.ref} · {s.parcelAddress ?? site?.address} <span style={{ color: FIT_COLOR[s.fit], fontSize: 13 }}>● {s.fit} fit</span></h3>
                    <p className="hint" style={{ marginTop: 4 }}>{site?.operators.map((o) => o.name).join(", ")} · {s.fitReason}</p>
                    <table className="summary-table"><tbody>
                      <tr><th scope="row">Owner of record</th><td>{s.owner ?? site?.parcel?.owner ?? "Not found"}{s.ownerType !== "unknown" ? ` (${s.ownerType})` : ""}{(s.ownerMailingAddress ?? site?.parcel?.mailingAddress) ? ` · mail: ${s.ownerMailingAddress ?? site?.parcel?.mailingAddress}` : ""}{!s.owner && site?.parcel?.owner ? " (appraisal roll)" : ""}</td></tr>
                      <tr><th scope="row">Parcel</th><td>{[s.parcelId && `ID ${s.parcelId}`, s.county && `${s.county} County`, s.ownedSince && `owned since ${s.ownedSince}`].filter(Boolean).join(" · ") || "—"}</td></tr>
                      <tr><th scope="row">Site</th><td>{[(s.acres ?? site?.parcel?.acres) != null && `${s.acres ?? site?.parcel?.acres} AC`, s.buildingSf != null && `${Math.round(s.buildingSf).toLocaleString("en-US")} SF bldg`, s.yearBuilt && `built ${s.yearBuilt}`].filter(Boolean).join(" · ") || "—"}</td></tr>
                      <tr><th scope="row">Zoning</th><td>{s.zoning ?? "—"} · outdoor storage {s.outdoorStorage}</td></tr>
                    </tbody></table>
                    {s.signals.length > 0 && <><strong>Off-market signals</strong><ul>{s.signals.map((x) => <li key={x}>{x}</li>)}</ul></>}
                    {s.outreach && (
                      <details><summary>Outreach draft (not sent)</summary>
                        <textarea readOnly value={s.outreach} rows={8} style={{ width: "100%" }} />
                        <button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(s.outreach)}>Copy</button>
                      </details>
                    )}
                    <details><summary>Sources ({s.sources.length}){s.unverified.length ? ` · ${s.unverified.length} unverified` : ""}</summary>
                      <ul>{s.sources.map((x) => <li key={x}><SourceLine text={x} /></li>)}</ul>
                      {s.unverified.length > 0 && <><em>Unverified</em><ul>{s.unverified.map((x) => <li key={x}>{x}</li>)}</ul></>}
                    </details>
                    {a?.dealId ? <p>Added. <Link href={`/deals/${a.dealId}`}>Open the prospect</Link></p>
                      : <button type="button" onClick={() => addProspect(s)} disabled={a?.busy}>{a?.busy ? "Adding…" : "Add as prospect"}</button>}
                    {a?.error && <p className="error">{a.error}</p>}
                  </article>
                );
              })}
            </>
          )}
        </section>
      )}

      {recent.length > 0 && !report && (
        <section className="panel">
          <h2>Recent sourcing runs</h2>
          <ul>{recent.map((r) => (
            <li key={r.id}>{r.created_at?.slice(0, 16).replace("T", " ")} · {r.status}{" "}
              {r.status === "completed" && load(r.id) && <button type="button" className="link-button" onClick={() => setRun({ id: r.id, status: "processing" })}>open</button>}
            </li>
          ))}</ul>
        </section>
      )}
    </>
  );
}
