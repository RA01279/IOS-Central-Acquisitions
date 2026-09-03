"use client";
// components/CompIntakeForm.tsx
//
// Comp intake in one surface: paste a broker's email table, or drop the
// spreadsheet they attached. Both land in the same editable review table,
// nothing saves until it's been looked at.
//
// Paste is the primary route and the drop zone is secondary, which is the
// opposite of what it looks like. Dragging a MESSAGE out of new Outlook gives
// you text at best -- it's a WebView2 shell around OWA, so there's no virtual
// .msg to catch. Dragging an ATTACHMENT does produce a real file, which is
// what the drop zone is for.

import { useRef, useState } from "react";

type CompType = "lease" | "sale";

interface DraftComp {
  compType: CompType;
  address: string;
  city: string | null;
  market: string | null;
  submarket: string | null;
  yearBuilt: number | null;
  buildingSf: number | null;
  lotSf: number | null;
  acres: number | null;
  coveragePct: number | null;
  rent: number | null;
  rentBasis: string | null;
  leaseType: string | null;
  dateCommenced: string | null;
  salePrice: number | null;
  closedOn: string | null;
  capRate: number | null;
  datePrecision: string;
  /** True when dateCommenced was backed into from an expiration, not stated. */
  dateEstimated?: boolean;
  leaseExpiresOn?: string | null;
  tenantName?: string | null;
  /** One tenancy inside a multi-tenant building, off a rent roll. */
  suite?: string | null;
  camPsfAnnual?: number | null;
  /** Coordinates the source file already carried; saved without re-geocoding. */
  latitude?: number | null;
  longitude?: number | null;
  region?: string | null;
  tenantUsage?: string | null;
  institutionalLandlord?: boolean | null;
  dealKind?: string | null;
  parkingSpaces?: number | null;
  ratePerStall?: number | null;
  sourceRef?: string | null;
  quotedPsf: number | null;
  warnings: string[];
  /** Which workbook tab this came from, when the source was a spreadsheet. */
  sheet?: string | null;
  // review state
  _include: boolean;
}

/**
 * One building out of a CoStar property report. Carries attributes and no
 * transaction, so it can't be a comp -- but it holds exactly the address and
 * market a rent roll leaves out.
 */
interface PropertyRecord {
  address: string;
  projectName: string | null;
  city: string | null;
  market: string | null;
  submarket: string | null;
  buildingSf: number | null;
  yearBuilt: number | null;
  acres: number | null;
  zoning: string | null;
}

function fmtNum(v: number | null) {
  return v === null || v === undefined ? "" : String(v);
}

export default function CompIntakeForm({
  markets,
  defaultMarket,
  defaultCity,
}: {
  markets: string[];
  defaultMarket?: string | null;
  defaultCity?: string | null;
}) {
  const [market, setMarket] = useState(defaultMarket ?? "");
  const [city, setCity] = useState(defaultCity ?? "");
  const [submarket, setSubmarket] = useState("");
  const [assetClass, setAssetClass] = useState("");
  // Rent-roll only. A roll's rows are suites in one building, so the address is
  // in the title block instead of a column, and the rows give an expiration
  // with no commencement -- the start date has to be backed into from a term.
  const [rollAddress, setRollAddress] = useState("");
  const [assumedTerm, setAssumedTerm] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [drafts, setDrafts] = useState<DraftComp[] | null>(null);
  // Buildings off a property report. Not comps -- they're what a rent roll is
  // missing, so they're offered as a pre-fill rather than saved.
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [source, setSource] = useState<string>("manual");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [seen, setSeen] = useState<{ lines: string[]; totalLines: number; headerCandidates: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const context = () => ({
    city: city || null,
    market: market || null,
    submarket: submarket || null,
    address: rollAddress || null,
    assumedTermMonths: assumedTerm ? Number(assumedTerm) : null,
  });

  async function sendToParser(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/comps/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, ...context() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not read that");
      setDrafts(
        (body.comps ?? []).map((c: any) => ({
          ...c,
          _include: true,
          assetClass: assetClass || null,
        }))
      );
      setProperties(body.properties ?? []);
      setWarnings(body.warnings ?? []);
      setSeen(body.seen ?? null);
      setSource(body.source ?? "manual");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // The clipboard carries text/html alongside text/plain when an email body is
  // copied. HTML has real cell boundaries, so it's sent in preference.
  function handlePaste(e: React.ClipboardEvent) {
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (!html && !text) return;
    e.preventDefault();
    sendToParser({ html: html || null, text: text || null });
  }

  async function handleFile(file: File) {
    if (!/\.(xlsx|xlsm|csv)$/i.test(file.name)) {
      setError(
        `"${file.name}" isn't a spreadsheet. Drop an .xlsx/.csv attachment, or paste the table from the email body instead.`
      );
      return;
    }
    const buf = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    const CHUNK = 8192; // avoid blowing the argument limit on a big file
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    setSourceRef(file.name);
    sendToParser({ fileBase64: btoa(binary), fileName: file.name });
  }

  /** FileSystemFileEntry.file() is callback-based; make it awaitable. */
  function entryToFile(entry: any): Promise<File> {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);

    // Everything must come off dataTransfer SYNCHRONOUSLY. The object is
    // neutered once the handler returns, so reading it after an await gives
    // nothing -- which looks exactly like an empty drop.
    const dt = e.dataTransfer;
    const files: File[] = dt.files ? Array.from(dt.files) : [];
    const virtualEntries: any[] = [];

    if (dt.items) {
      for (const item of Array.from(dt.items)) {
        if (item.kind !== "file") continue;
        const asFile = item.getAsFile?.();
        if (asFile) {
          // dataTransfer.files usually already has it; don't process twice.
          if (!files.some((f) => f.name === asFile.name && f.size === asFile.size)) {
            files.push(asFile);
          }
          continue;
        }
        // Dragging an attachment out of new Outlook yields a VIRTUAL file --
        // it isn't on disk, so dataTransfer.files is empty and getAsFile()
        // returns null. Chromium exposes it here instead.
        const entry = (item as any).webkitGetAsEntry?.();
        if (entry?.isFile) virtualEntries.push(entry);
      }
    }

    const html = dt.getData("text/html");
    const text = dt.getData("text/plain");

    void (async () => {
      const spreadsheet = files.find((f) => /\.(xlsx|xlsm|csv)$/i.test(f.name));
      if (spreadsheet) {
        handleFile(spreadsheet);
        return;
      }

      // Virtual files, resolved after the synchronous capture above.
      for (const entry of virtualEntries) {
        try {
          const file = await entryToFile(entry);
          if (/\.(xlsx|xlsm|csv)$/i.test(file.name)) {
            handleFile(file);
            return;
          }
          if (/\.msg$/i.test(file.name)) {
            setError(
              `"${file.name}" is an Outlook message file, which Hopper can't read. Open it and paste the comp table from the body instead.`
            );
            return;
          }
          setError(
            `"${file.name}" isn't a spreadsheet. Drop an .xlsx, .xlsm or .csv, or paste the table from the email body.`
          );
          return;
        } catch {
          // Fall through to the text paths below.
        }
      }

      // A non-spreadsheet real file (e.g. a dragged PDF).
      if (files.length) {
        setError(
          `"${files[0].name}" isn't a spreadsheet. Drop an .xlsx, .xlsm or .csv, or paste the table from the email body.`
        );
        return;
      }

      if (html || text) {
        sendToParser({ html: html || null, text: text || null });
        return;
      }

      setError(
        "That drop arrived empty — new Outlook sometimes hands over nothing a browser can read. Use “Choose a spreadsheet” below to pick the file, or save the attachment and drop it from a folder. Pasting the table from the email body always works."
      );
    })();
  }

  function update(i: number, patch: Partial<DraftComp>) {
    setDrafts((prev) => (prev ? prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)) : prev));
  }

  // Mirrors the server's validation so a row that can't save is obvious before
  // clicking, not after.
  function blockingIssue(d: DraftComp): string | null {
    if (!d.address?.trim()) return "needs an address";
    if (d.compType === "lease") {
      if (!d.rent) return "needs a rent";
      if (!d.dateCommenced) return "needs a commencement date";
    } else {
      if (!d.salePrice) return "needs a price";
      if (!d.closedOn) return "needs a close date";
    }
    return null;
  }

  const included = (drafts ?? []).filter((d) => d._include);
  const blocked = included.filter((d) => blockingIssue(d));

  async function handleSave() {
    if (!drafts) return;
    setBusy(true);
    setError(null);
    try {
      const rows = included.map((d) => ({ ...d, assetClass: assetClass || null }));

      // Saved in batches rather than one request.
      //
      // Row count was never the binding constraint -- 272 comps is 0.35 MB, and
      // the body cap would take ~3,500. TIME is. Rows that arrive with their
      // own coordinates cost nothing, but a file without them geocodes at five
      // concurrent Google calls, so ~500 rows is ~20 seconds and a serverless
      // function will cut that off. One request meant one timeout lost the
      // whole import with no way to tell what had landed.
      //
      // Batching also makes a partial failure legible: each batch reports its
      // own saved/duplicate/rejected counts and they add up.
      const BATCH = 100;
      const totals: any = {
        saved: 0, duplicates: 0, rejected: [], failed: [],
        geocoding: { centroidOnly: 0, failed: 0, fromFile: 0 },
        batches: 0,
      };
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH);
        const res = await fetch("/api/comps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comps: slice, source, sourceRef: sourceRef || null }),
        });
        const body = await res.json();
        if (!res.ok && body.saved === undefined) {
          // Say what already landed, so a mid-way failure isn't a mystery.
          throw new Error(
            totals.saved > 0
              ? `${body.error ?? "Save failed"} — ${totals.saved} comps from earlier batches were saved and are in the repository.`
              : (body.error ?? "Save failed")
          );
        }
        totals.saved += body.saved ?? 0;
        totals.duplicates += body.duplicates ?? 0;
        totals.rejected.push(...(body.rejected ?? []));
        totals.failed.push(...(body.failed ?? []));
        totals.geocoding.centroidOnly += body.geocoding?.centroidOnly ?? 0;
        totals.geocoding.failed += body.geocoding?.failed ?? 0;
        totals.geocoding.fromFile += body.geocoding?.fromFile ?? 0;
        totals.batches++;
        // Progress, because 300 rows is several seconds of nothing otherwise.
        setWarnings([`Saving… ${Math.min(i + BATCH, rows.length)} of ${rows.length}`]);
      }
      setWarnings([]);
      setResult(totals);
      setDrafts(null);
      setWarnings([]);
      setSeen(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Add comps</h2>

      <div className="grid-2">
        <label>
          Market * — the metro
          <input
            list="comp-markets"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            placeholder="Houston"
          />
          <datalist id="comp-markets">
            {markets.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label>
          City *
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Conroe" />
        </label>
        <label>
          Submarket — within the metro
          <input
            value={submarket}
            onChange={(e) => setSubmarket(e.target.value)}
            placeholder="Conroe"
          />
        </label>
        <label>
          Asset class
          <select value={assetClass} onChange={(e) => setAssetClass(e.target.value)}>
            <option value="">—</option>
            <option value="ios">IOS</option>
            <option value="industrial">Industrial</option>
          </select>
        </label>
      </div>
      <p className="hint">
        Market is the metro (Houston); submarket is the pocket within it (Conroe). Broker tables
        carry bare street addresses, so these are applied to every row — without them the addresses
        geocode to a county centroid and distance matching stops working. What you type here wins
        over the spreadsheet&apos;s own Market/Submarket columns; where you leave one blank, the
        sheet fills it in and the table below shows what each row got.
      </p>
      <p className="hint">
        <strong>Leave Market and City blank for a multi-market file.</strong> A file that carries
        its own market per row — like the standard TX IOS comp table, which spans Dallas, Houston,
        Fort Worth, San Antonio, Austin and Laredo on one tab — will otherwise have every row filed
        under whatever you type. If that happens the warnings say so and name the markets you
        overrode, so it&apos;s recoverable rather than silent.
      </p>

      {/* A rent roll is contracted rent at a comparable property, which is
          better evidence than an asking rate -- but it arrives shaped unlike
          any broker table, so it needs two facts the table itself never
          states. Left blank, nothing here changes how anything else parses. */}
      <details className="comp-rentroll">
        <summary>Dropping a rent roll? Two extra fields</summary>
        <div className="grid-2" style={{ marginTop: 10 }}>
          <label>
            Property address — the building the suites are in
            <input
              value={rollAddress}
              onChange={(e) => setRollAddress(e.target.value)}
              placeholder="2025 Louisville Rd"
            />
          </label>
          <label>
            Assumed lease term (months)
            <input
              type="number"
              min={1}
              max={480}
              value={assumedTerm}
              onChange={(e) => setAssumedTerm(e.target.value)}
              placeholder="60"
            />
          </label>
        </div>
        <p className="hint">
          A roll lists suites in <em>one</em> building, so its address sits in the title block
          rather than in a column — without it every row is rejected for having no address. And a
          roll gives a lease <strong>expiration</strong>, rarely a commencement and almost never a
          term, so the start date is estimated as expiration minus the term you give here. Anything
          dated that way is flagged as an estimate on the comp and stays flagged — recency is the
          heaviest factor in matching, so a date nobody actually knows must never read like one off
          an executed lease. Where a row <em>does</em> state a term, that wins and no estimate is
          made.
        </p>
      </details>

      <div
        className={dragging ? "comp-dropzone comp-dropzone-active" : "comp-dropzone"}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        tabIndex={0}
        role="textbox"
        aria-label="Paste comp table or drop a spreadsheet"
      >
        <strong>Click here, then paste the comp table</strong>
        <span className="muted">
          Select the table in the email body, Ctrl+C, then Ctrl+V here — the copied HTML keeps the
          real columns.
        </span>
        <span className="muted">
          Got a spreadsheet? Use the button — dragging an attachment straight out of new Outlook
          often hands the browser nothing it can read.
        </span>
        <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
          Choose a spreadsheet
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xlsm,.csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {busy && <p className="hint">Reading…</p>}
      {error && <p className="error">{error}</p>}

      {warnings.length > 0 && (
        <div className="warning">
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* A property report can't be saved as comps -- it has no transaction in
          it. What it can do is answer the two questions a rent roll can't, so
          it's offered as a pre-fill instead of reported as a failure. */}
      {properties.length > 0 && (
        <div className="panel-inset" style={{ marginBottom: 14 }}>
          <h3 style={{ marginTop: 0 }}>
            Buildings in that report <span className="count">{properties.length}</span>
          </h3>
          <div className="table-scroll">
            <table className="summary-table log-table">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Bldg</th>
                  <th>Market · Submarket</th>
                  <th>RBA</th>
                  <th>Acres</th>
                  <th>Built</th>
                  <th>Zoning</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {properties.map((p, i) => (
                  <tr key={i}>
                    <td>{p.address}</td>
                    <td>{p.projectName ?? "—"}</td>
                    <td className="muted">
                      {[p.market, p.submarket].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td>{p.buildingSf ? Math.round(p.buildingSf).toLocaleString() : "—"}</td>
                    <td>{p.acres ?? "—"}</td>
                    <td>{p.yearBuilt ?? "—"}</td>
                    <td>{p.zoning ?? "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setRollAddress(p.address);
                          if (p.city) setCity(p.city);
                          if (p.market) setMarket(p.market);
                          if (p.submarket) setSubmarket(p.submarket);
                          setProperties([]);
                          setWarnings([
                            `Using ${[p.address, p.projectName].filter(Boolean).join(" · ")} — ` +
                              `now drop the rent roll for that building.`,
                          ]);
                        }}
                      >
                        Use for a rent roll
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            These are property attributes, not transactions — no rent and no closed sale, so there
            is nothing here to save as a comp. Pick the building your rent roll belongs to and its
            address, city, market and submarket fill in above. Where a report <em>does</em> carry a
            Last Sale Date and Last Sale Price, those rows come through as sale comps instead.
          </p>
        </div>
      )}

      {/* When nothing parses, show what actually arrived. "No rows recognised"
          on its own is a dead end; seeing the flattened text distinguishes a
          table that never came through from one whose header wasn't matched. */}
      {seen && (
        <details className="pipeline-more" style={{ marginBottom: 12 }}>
          <summary>Show what Hopper received ({seen.totalLines} lines)</summary>
          {seen.headerCandidates.length > 0 && (
            <p className="hint" style={{ marginTop: 8 }}>
              Rows that look like headers — if your header is here, one of its column names isn&apos;t
              recognised yet. Send it over and I&apos;ll add the alias.
            </p>
          )}
          <pre
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 10,
              fontSize: 12,
              overflowX: "auto",
              whiteSpace: "pre",
            }}
          >
            {[...seen.headerCandidates, ...seen.lines].join("\n") || "(nothing)"}
          </pre>
        </details>
      )}

      {result && (
        <div className={result.saved ? "warning" : "error"} style={{ background: result.saved ? "#e8f5e9" : undefined }}>
          <p style={{ margin: 0 }}>
            Saved {result.saved} comp{result.saved === 1 ? "" : "s"}
            {result.duplicates ? ` · ${result.duplicates} already in the repository` : ""}
            {result.rejected?.length ? ` · ${result.rejected.length} rejected` : ""}
            {result.geocoding?.centroidOnly
              ? ` · ${result.geocoding.centroidOnly} only resolved to a centroid (won't distance-match)`
              : ""}
            {/* Worth saying: it means the file's own coordinates were kept
                rather than re-resolved, which is both cheaper and better. */}
            {result.geocoding?.fromFile
              ? ` · ${result.geocoding.fromFile} used coordinates from the file`
              : ""}
            {result.geocoding?.failed
              ? ` · ${result.geocoding.failed} couldn't be geocoded`
              : ""}
            {result.batches > 1 ? ` · saved in ${result.batches} batches` : ""}
          </p>
          {result.failed?.length > 0 && (
            <ul>
              {result.failed.slice(0, 10).map((f: any, i: number) => (
                <li key={i}>
                  {f.address} — {f.reason}
                </li>
              ))}
            </ul>
          )}
          {result.rejected?.length > 0 && (
            <ul>
              {result.rejected.map((r: any, i: number) => (
                <li key={i}>
                  {r.address} — {r.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {drafts && drafts.length > 0 && (
        <>
          <h2 style={{ marginTop: 20 }}>
            Review <span className="count">{included.length}</span>
          </h2>
          <p className="hint">
            Fill in anything missing — dates especially, since broker lease tables usually omit
            them. Untick a row to leave it out.
          </p>

          {/* Per-tab selection. A workbook's tabs are frequently different
              datasets -- one real file had two tabs of Conroe comps and one of
              Houston Southwest comps 47 miles away -- and unticking sixteen
              rows by hand to drop the odd one out is nobody's idea of a good
              time. */}
          {(() => {
            const tabs = Array.from(
              new Set(drafts.map((d) => d.sheet).filter(Boolean) as string[])
            );
            if (tabs.length < 2) return null;
            return (
              <div className="filter-chips">
                {tabs.map((tab) => {
                  const rows = drafts.filter((d) => d.sheet === tab);
                  const on = rows.filter((d) => d._include).length;
                  return (
                    <button
                      key={tab}
                      type="button"
                      className={on > 0 ? "chip chip-active" : "chip"}
                      onClick={() =>
                        setDrafts((prev) =>
                          prev
                            ? prev.map((d) => (d.sheet === tab ? { ...d, _include: on === 0 } : d))
                            : prev
                        )
                      }
                      title={on > 0 ? `Exclude all ${rows.length} from “${tab}”` : `Include all from “${tab}”`}
                    >
                      {tab} · {on}/{rows.length}
                    </button>
                  );
                })}
              </div>
            );
          })()}
          <div className="table-scroll">
            <table className="summary-table log-table">
              <thead>
                <tr>
                  <th />
                  <th>Type</th>
                  <th>Address</th>
                  <th>Market · Submarket</th>
                  <th>Date</th>
                  <th>Price / Rent</th>
                  <th>Basis</th>
                  <th>Bldg SF</th>
                  <th>Acres</th>
                  <th>Cov.</th>
                  <th>Yr</th>
                  <th>Tab</th>
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d, i) => {
                  const issue = blockingIssue(d);
                  return (
                    <tr key={i} style={{ opacity: d._include ? 1 : 0.45 }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={d._include}
                          onChange={(e) => update(i, { _include: e.target.checked })}
                          aria-label={`Include ${d.address}`}
                        />
                      </td>
                      <td>
                        <select
                          value={d.compType}
                          onChange={(e) => update(i, { compType: e.target.value as CompType })}
                        >
                          <option value="sale">Sale</option>
                          <option value="lease">Lease</option>
                        </select>
                      </td>
                      <td>
                        <input
                          value={d.address}
                          onChange={(e) => update(i, { address: e.target.value })}
                          style={{ minWidth: 190 }}
                        />
                        {/* Nine rent-roll rows share one address; the suite is
                            the only thing telling them apart. */}
                        {(d.suite || d.tenantName) && (
                          <div className="muted" style={{ fontSize: "0.85em" }}>
                            {[d.suite, d.tenantName].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </td>
                      {/* Market shown, not just submarket: a multi-market file
                          is exactly where a wrong market is worth catching
                          before 282 rows are filed under one metro. */}
                      <td className="muted">
                        {[d.market, d.submarket].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td>
                        <input
                          type="date"
                          value={(d.compType === "sale" ? d.closedOn : d.dateCommenced) ?? ""}
                          onChange={(e) =>
                            update(
                              i,
                              d.compType === "sale"
                                ? { closedOn: e.target.value || null }
                                : // Typing a real date makes it no longer an
                                  // estimate, so the flag has to clear.
                                  { dateCommenced: e.target.value || null, dateEstimated: false }
                            )
                          }
                        />
                        {d.dateEstimated && (
                          <div
                            className="muted"
                            style={{ fontSize: "0.85em" }}
                            title={`Estimated from the ${d.leaseExpiresOn ?? "expiration"} expiry minus the assumed term. Overwrite it if you know the real start date.`}
                          >
                            estimated
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          value={fmtNum(d.compType === "sale" ? d.salePrice : d.rent)}
                          onChange={(e) => {
                            const n = e.target.value === "" ? null : Number(e.target.value.replace(/[$,]/g, ""));
                            update(i, d.compType === "sale" ? { salePrice: n } : { rent: n });
                          }}
                          style={{ width: 110 }}
                        />
                      </td>
                      {/* The basis is shown because it's where a 12x error
                          hides: an annual rate read as monthly looks plausible. */}
                      <td className="muted">
                        {d.compType === "sale"
                          ? "sale"
                          : (d.rentBasis ?? "—").replace(/_/g, " ").replace("per sf bldg ", "$/SF ")}
                      </td>
                      <td>
                        <input
                          value={fmtNum(d.buildingSf)}
                          onChange={(e) =>
                            update(i, { buildingSf: e.target.value === "" ? null : Number(e.target.value) })
                          }
                          style={{ width: 80 }}
                        />
                      </td>
                      <td>
                        <input
                          value={fmtNum(d.acres)}
                          onChange={(e) =>
                            update(i, { acres: e.target.value === "" ? null : Number(e.target.value) })
                          }
                          style={{ width: 66 }}
                        />
                      </td>
                      <td>{d.coveragePct === null ? "—" : `${(d.coveragePct * 100).toFixed(1)}%`}</td>
                      <td>{fmtNum(d.yearBuilt) || "—"}</td>
                      {/* Which tab it came from: a workbook's tabs are often
                          different datasets, so this is how you spot the one
                          that doesn't belong before saving it. */}
                      <td className="muted">{d.sheet ?? "—"}</td>
                      <td className="muted" style={{ whiteSpace: "normal", minWidth: 170 }}>
                        {issue && <strong className="overdue">{issue}</strong>}
                        {issue && d.warnings.length > 0 && " · "}
                        {d.warnings.join(" · ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="stage-actions" style={{ marginTop: 12 }}>
            <button onClick={handleSave} disabled={busy || !included.length || blocked.length > 0}>
              {busy ? "Saving…" : `Save ${included.length} comp${included.length === 1 ? "" : "s"}`}
            </button>
            <button type="button" className="secondary" onClick={() => setDrafts(null)}>
              Discard
            </button>
            {blocked.length > 0 && (
              <span className="error">
                {blocked.length} row{blocked.length === 1 ? "" : "s"} still missing a required field
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
