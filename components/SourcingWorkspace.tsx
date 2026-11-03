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
import SourcingExportAssignment from "./SourcingExportAssignment";
import { assignmentFor, type ExportAssignee } from "@/lib/sourcing/export-assignment";
import { blocksSourcing } from "@/lib/sourcing/identity";
import { reviewedSites, validBuyBox } from "@/lib/sourcing/snapshot";
import { usableSummary, type UsableAcres } from "@/lib/sourcing/usable-summary";

/** Net usable acres for a sweep row, with what was taken off underneath. */
function UsableCell({ u, hasParcel, strong }: { u?: UsableAcres | null; hasParcel: boolean; strong: boolean }) {
  if (!u) return <span className="hint">{hasParcel ? "Not measured" : "—"}</span>;
  const off = [u.buildingsAcres && `bldgs −${u.buildingsAcres}`, u.floodAcres && `flood −${u.floodAcres}`, u.wetlandsAcres && `wetland −${u.wetlandsAcres}`].filter(Boolean).join(" · ");
  return (
    <span title={`${usableSummary(u)}. ${u.notChecked.join(", ")} not checked.`}>
      <span style={{ fontWeight: strong ? 600 : 400 }}>{u.failed.length ? "≤" : ""}{u.netAcres}</span>
      <br /><span className="hint">{off || "no deductions"} · {u.coveragePct}% cov</span>
      {u.failed.length > 0 && <><br /><span className="hint">{u.failed.join(", ")} not read</span></>}
    </span>
  );
}

type Sweep = { sweepId?: string; market?: string; createdAt?: string; coverage?: { requests: number; budget: number; partial: boolean; budgetExhausted: boolean; deadlineReached: boolean }; center: { lat: number; lng: number }; label: string; radiusMiles: number; sites: Site[]; screened: number; failedSearches: number; note: string; criteriaKey?: string; profileIds?: string[]; searches?: { profileId: string; profile: string; keyword: string; failed: boolean; returned: number; limited: boolean; pages?: number; cells?: number }[]; contacts?: { requested: number; failed: number } };
type Saved = { market: string; buyBox: BuyBox; sites: Site[]; searchLabel?: string };
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
  const [exportAssigneeKey, setExportAssigneeKey] = useState("");
  const [exportAssignees, setExportAssignees] = useState<ExportAssignee[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [directoryRevision, setDirectoryRevision] = useState(0);
  const [online, setOnline] = useState<boolean | null>(null);
  const [recent, setRecent] = useState<RunInfo[]>([]);
  const [savedSweeps, setSavedSweeps] = useState<{ id: string; created_at: string; label: string }[]>([]);
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
        if (typeof saved.exportAssigneeKey === "string") setExportAssigneeKey(saved.exportAssigneeKey);
      }
    } catch { /* storage may be unavailable */ }
    setRestored(true);
    return () => { sweepRequest.current.controller?.abort(); sweepRequest.current.version++; };
  }, [viewerKey]);
  useEffect(() => {
    if (!restored) return;
    try { sessionStorage.setItem(`sourcing-results-v2:${viewerKey}`, JSON.stringify({ profileIds, marketKey, submarketKey, mode, address, radius, buyBox, sweep, showKnown, hidePublic, inBoxOnly, ownerUsersFirst, selected, report, run, added, exportAssigneeKey })); } catch { /* quota or storage unavailable */ }
  }, [restored, viewerKey, profileIds, marketKey, submarketKey, mode, address, radius, buyBox, sweep, showKnown, hidePublic, inBoxOnly, ownerUsersFirst, selected, report, run, added, exportAssigneeKey]);

  const hasResults = !!(sweep || report);
  useEffect(() => {
    if (!hasResults) return;
    const controller = new AbortController();
    let live = true;
    setDirectoryLoading(true); setDirectoryError(null);
    void (async () => {
      try {
        const response = await fetch("/api/sourcing/export-assignees", { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load broker directory.");
        if (live) setExportAssignees(data.assignees ?? []);
      } catch (e: any) { if (live && e.name !== "AbortError") { setExportAssignees([]); setDirectoryError(e.message); } }
      finally { if (live) setDirectoryLoading(false); }
    })();
    return () => { live = false; controller.abort(); };
  }, [hasResults, directoryRevision]);

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
        const r = await fetch("/api/agents?agent=off-market-sourcing", { cache: "no-store" });
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

  useEffect(() => {
    let live = true;
    void fetch("/api/sourcing/sweeps", { cache: "no-store" }).then(async r => {
      if (!r.ok) return; const d = await r.json(); if (live) setSavedSweeps(d.sweeps ?? []);
    }).catch(() => {});
    return () => { live = false; };
  }, [sweep?.sweepId]);

  async function openSweep(id: string) {
    cancelPendingSweep(); setError(null);
    try {
      const r = await fetch(`/api/sourcing/sweeps?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Could not open sweep");
      setSweep(data); setReport(null); setRun(null); setSelected([]); setAdded({});
    } catch (e: any) { setError(e.message); }
  }

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
          const saved = reviewedSites(d.sources) ?? load(run.id);
          const parsed = parseSourcing(d.result.report, saved?.sites.map(s => s.ref));
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
    if (!sweep.sweepId) { setError("Run a new sweep to save the reviewed sites before qualifying."); return; }
    if (!validBuyBox(buyBox)) { setError("Check the usable-acreage range and maximum coverage."); return; }
    const sites = sweep.sites.filter((s) => selected.includes(s.ref) && !blocksSourcing(s));
    setBusy("agent"); setError(null); setReport(null); setAdded({});
    try {
      const r = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent: "off-market-sourcing", text: "", sweepId: sweep.sweepId, refs: sites.map(s => s.ref), buyBox }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not start the agent.");
      save(d.id, { market: sweep.market ?? "", buyBox, sites, searchLabel: sweep.label });
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
        body: JSON.stringify({ runId: run.id, ref: s.ref }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not add the prospect.");
      setAdded((a) => ({ ...a, [s.ref]: { dealId: d.dealId } }));
    } catch (e: any) { setAdded((a) => ({ ...a, [s.ref]: { error: e.message } })); }
  }

  async function exportSites(sites: Site[], label: string, research?: SourcedSite[]) {
    if (!sites.length || exporting) return;
    const assignment = assignmentFor(exportAssignees, exportAssigneeKey);
    if (exportAssigneeKey && (directoryLoading || directoryError || !assignment)) {
      setExportError("Choose an available broker / firm, or clear the assignment before exporting.");
      return;
    }
    setExporting(true); setExportError(null);
    try {
      const { downloadSourcingWorkbook } = await import("@/lib/sourcing/export");
      await downloadSourcingWorkbook(sites, label, research, assignment);
    } catch {
      setExportError("Could not export the workbook. Please try again.");
    } finally { setExporting(false); }
  }

  // Measured net usable acres where the parcel outline was measured, else gross parcel acres.
  const sizeOf = (s: Site) => s.usable?.netAcres ?? s.parcel?.acres ?? null;
  const inBox = (s: Site) => { const a = sizeOf(s); return a != null && a >= buyBox.minAcres && a <= buyBox.maxAcres && (s.usable == null || s.usable.coveragePct <= buyBox.maxCoveragePct); };
  const visible = useMemo(() => {
    const list = (sweep?.sites ?? []).filter((s) => (showKnown || !blocksSourcing(s)) && (!hidePublic || s.parcel?.ownerClass !== "public") && (!inBoxOnly || sizeOf(s) == null || inBox(s)));
    const rank = (s: Site) => (s.identityStatus === "address-conflict" ? -5 : s.parcel ? 3 : 0) + (inBox(s) ? 2 : (sizeOf(s) ?? Infinity) < buyBox.minAcres ? -4 : 0) + (s.ownerUser ? .5 : 0);
    return ownerUsersFirst ? [...list].sort((a, b) => rank(b) - rank(a) || a.distanceMi - b.distanceMi) : list;
  }, [sweep, showKnown, hidePublic, inBoxOnly, ownerUsersFirst, buyBox]);
  const publicCount = (sweep?.sites ?? []).filter((s) => s.parcel?.ownerClass === "public").length;
  const knownCount = (sweep?.sites ?? []).filter(blocksSourcing).length;
  const points: MapPoint[] = useMemo(() => {
    const src = report ? report.saved.sites.filter((s) => report.sites.some((r) => r.ref === s.ref)) : visible;
    const fit = new Map(report?.sites.map((s) => [s.ref, s.fit]) ?? []);
    return [
      ...(sweep && !report ? [{ id: "center", lat: sweep.center.lat, lng: sweep.center.lng, color: "132B46", title: sweep.label, lines: [`${sweep.radiusMiles} mi sweep centre`], emphasis: true }] : []),
      ...src.map((s) => ({
        id: s.ref, lat: s.lat, lng: s.lng,
        color: blocksSourcing(s) ? "9AA3AD" : report ? (FIT_COLOR[fit.get(s.ref) ?? "unknown"] ?? "#66717E").slice(1) : selected.includes(s.ref) ? "0E5AA7" : "2E6DA4",
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
      <p className="hint">Businesses that run outdoor yards — trucking, equipment rental, contractors, container storage, building materials — can reveal potential IOS sites, whether listed or off market. Sweep a submarket and Hopper pulls each site's owner of record from the county appraisal roll. Pick the sites worth chasing and the agent researches the owner, confirms occupancy and zoning, and drafts outreach. Nothing is sent; you add the good ones to the pipeline.</p>

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
        <button type="submit" disabled={!restored || !profileIds.length || busy !== null || (mode === "address" && !address.trim())}>{busy === "sweep" ? "Sweeping… (up to two minutes)" : "Sweep"}</button>
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
            {sweep.coverage && <p className="hint">Search coverage: {sweep.coverage.requests} of {sweep.coverage.budget} requests used. {sweep.coverage.partial ? "Some areas remain limited or incomplete." : "Available pages checked; Google results are still a sample."} {sweep.createdAt && `Saved ${new Date(sweep.createdAt).toLocaleString()}.`}</p>}
            {sweep.searches && <details><summary>Google search coverage ({sweep.searches.filter((s) => !s.failed).length}/{sweep.searches.length} searches succeeded)</summary><ul>{sweep.searches.map((s) => <li key={`${s.profileId}:${s.keyword}`}>{s.profile}: {s.keyword} — {s.failed ? "failed; results incomplete" : `${s.returned} results across ${s.pages ?? 1} pages / ${s.cells ?? 1} areas${s.limited ? "; coverage remains limited" : ""}`}</li>)}</ul></details>}
            {!!sweep.contacts?.failed && <p role="status">Business contact lookup incomplete for {sweep.contacts.failed} of {sweep.contacts.requested} businesses. Unavailable phone and website fields remain blank.</p>}
          </>}
          {exportError && <p role="alert" className="error">{exportError}</p>}
          {exporting && <p role="status">Preparing Excel export...</p>}
          <SourcingExportAssignment assignees={exportAssignees} value={exportAssigneeKey} onChange={(key) => { setExportAssigneeKey(key); setExportError(null); }} loading={directoryLoading} error={directoryError} retry={() => setDirectoryRevision((v) => v + 1)} />
          {sweep && !report && (
            <p className="hint">
              {sweep.label}: {sweep.sites.length - knownCount} new yard site{sweep.sites.length - knownCount === 1 ? "" : "s"}
              {knownCount > 0 && <> · {knownCount} matching active deals / owned assets (<button type="button" className="link-button" onClick={() => setShowKnown(!showKnown)}>{showKnown ? "hide" : "show"}</button>)</>}
              {publicCount > 0 && <> · {publicCount} publicly owned{hidePublic ? " (hidden)" : ""}</>}
              {" · "}{sweep.screened} listings screened out as non-yard uses{sweep.failedSearches ? ` · ${sweep.failedSearches} searches failed` : ""}. {sweep.note}
            </p>
          )}
          <MapView points={points} height={440} emptyMessage="No yard users found here. Try a wider radius or another submarket." />
          {sweep && !report && (
            <>
              <p style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <label><input type="checkbox" checked={hidePublic} onChange={(e) => setHidePublic(e.target.checked)} /> Hide publicly owned</label>
                <label><input type="checkbox" checked={inBoxOnly} onChange={(e) => setInBoxOnly(e.target.checked)} /> Filter to buy box ({buyBox.minAcres}–{buyBox.maxAcres} net usable acres, ≤{buyBox.maxCoveragePct}% coverage; gross acres where not measured; unknowns retained)</label>
                <label><input type="checkbox" checked={ownerUsersFirst} onChange={(e) => setOwnerUsersFirst(e.target.checked)} /> Prioritize documented parcel and size signals</label>
              </p>
              <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button type="button" className="secondary" disabled={exporting || !selected.length} onClick={() => exportSites(sweep.sites.filter((s) => selected.includes(s.ref)), sweep.label)}>Export selected to Excel ({selected.length})</button>
                <button type="button" className="secondary" disabled={exporting || !visible.length} onClick={() => exportSites(visible, `${sweep.label} | ${sweep.radiusMiles} mi | Profiles: ${SOURCING_PROFILES.filter((p) => sweep.profileIds?.includes(p.id)).map((p) => p.label).join(", ") || "All profiles"} | ${sweep.failedSearches} failed searches | Bounded Google sample`)}>Export filtered results to Excel ({visible.length})</button>
              </p>
              <div style={{ overflowX: "auto" }}>
                <table className="summary-table">
                  <thead><tr><th></th><th>Site</th><th>Operators</th><th>Owner of record</th><th>Gross acres</th><th>Net usable</th><th>Built</th><th>Address</th><th>Distance</th><th>In Hopper</th></tr></thead>
                  <tbody>
                    {visible.map((s) => (
                      <tr key={s.ref} data-site-ref={s.ref}>
                        <td>{!blocksSourcing(s) && <input type="checkbox" aria-label={`Select ${s.ref}`} checked={selected.includes(s.ref)} onChange={() => toggle(s.ref)} disabled={!selected.includes(s.ref) && selected.length >= MAX_SOURCING_SITES} />}</td>
                        <td>{s.ref}</td>
                        <td>{s.operators.map((o) => <div key={o.placeId} data-place-id={o.placeId} data-profile-ids={o.profileIds?.join(",")}><strong>{o.name}</strong><br /><span className="hint">Matched profiles: {(o.categories ?? [o.category]).join(", ")}</span><br />{o.phone && <>Business phone: {o.phone}<br /></>}{o.website && <><a href={o.website} target="_blank" rel="noopener noreferrer">Business website</a>{" · "}</>}<a href={o.googleUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.name)}&query_place_id=${encodeURIComponent(o.placeId)}`} target="_blank" rel="noopener noreferrer">Google business source</a></div>)}<span className="hint">Business contacts are not verified owner contacts.</span></td>
                        <td>{s.parcel?.owner ?? "Owner unverified"}{s.ownerUser && <span className="hint"> · possible owner-user (name similarity only)</span>}{s.parcel && s.parcel.ownerClass !== "private" && <span className="hint"> · {s.parcel.ownerClass}</span>}</td>
                        <td>{s.parcel?.acres ?? "—"}</td>
                        <td style={{ color: sizeOf(s) != null && !inBox(s) ? "#8a8f98" : undefined }}><UsableCell u={s.usable} hasParcel={!!s.parcel} strong={inBox(s)} /></td>
                        <td>{s.parcel?.yearBuilt ?? "—"}</td>
                        <td>{s.address}{s.identityStatus === "address-conflict" && <p className="hint" role="status">Listing / parcel address conflict: {s.parcel?.situsAddress}. Review location.</p>}{!s.parcel && <p className="hint">Parcel not returned; ownership and area remain unverified.</p>}</td>
                        <td>{s.distanceMi.toFixed(1)} mi</td>
                        <td>{s.known && <div><Link href={s.known.href}>{s.known.relation ?? s.known.kind}</Link> · same property ({s.known.evidence})</div>}{s.nearby?.map(k => <div key={`${k.kind}:${k.id}`}><Link href={k.href}>{k.label}</Link> · {k.match === "same_property" ? "same property" : "nearby, not a duplicate"}</div>)}{!s.known && !s.nearby?.length && "—"}</td>
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
              <button type="button" className="secondary" disabled={exporting || !report.sites.length} onClick={() => exportSites(report.saved.sites.filter((s) => report.sites.some((r) => r.ref === s.ref)), report.saved.searchLabel ?? report.saved.market, report.sites)}>Export qualified sites to Excel ({report.sites.length})</button>
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
                      <tr><th scope="row">Usable yard</th><td>{site?.usable ? <>{usableSummary(site.usable)} acres, measured from the parcel outline. <span className="hint">{site.usable.notChecked.join(", ")} not checked.</span>{s.usableAcres != null && <span className="hint"> Researched: {s.usableAcres} acres.</span>}</> : s.usableAcres == null ? "Unverified; gross parcel acres are not usable yard acres" : `${s.usableAcres} acres`}</td></tr>
                      <tr><th scope="row">Building footprint</th><td>{site?.usable ? `${site.usable.buildingFootprintSf.toLocaleString("en-US")} SF measured across ${site.usable.buildingCount} building${site.usable.buildingCount === 1 ? "" : "s"} (${site.usable.coveragePct}% coverage)` : s.buildingFootprintSf == null ? "Unverified" : `${s.buildingFootprintSf.toLocaleString()} SF`}</td></tr>
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
              {r.status === "completed" && <button type="button" className="link-button" onClick={() => setRun({ id: r.id, status: "processing" })}>open</button>}
            </li>
          ))}</ul>
        </section>
      )}
      {savedSweeps.length > 0 && <section className="panel"><h2>Saved sweeps</h2><p className="hint">Reopen the original reviewed sites from any browser.</p><ul>{savedSweeps.map(s => <li key={s.id}>{new Date(s.created_at).toLocaleString()} · {s.label} <button type="button" className="link-button" onClick={() => void openSweep(s.id)}>Open sweep</button></li>)}</ul></section>}
    </>
  );
}
