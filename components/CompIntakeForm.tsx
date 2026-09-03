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
  quotedPsf: number | null;
  warnings: string[];
  /** Which workbook tab this came from, when the source was a spreadsheet. */
  sheet?: string | null;
  // review state
  _include: boolean;
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
  const [sourceRef, setSourceRef] = useState("");
  const [drafts, setDrafts] = useState<DraftComp[] | null>(null);
  const [source, setSource] = useState<string>("manual");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [seen, setSeen] = useState<{ lines: string[]; totalLines: number; headerCandidates: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const context = () => ({ city: city || null, market: market || null, submarket: submarket || null });

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
      const res = await fetch("/api/comps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comps: included.map((d) => ({ ...d, assetClass: assetClass || null })),
          source,
          sourceRef: sourceRef || null,
        }),
      });
      const body = await res.json();
      if (!res.ok && !body.saved) throw new Error(body.error ?? "Save failed");
      setResult(body);
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
          </p>
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
                  <th>Submarket</th>
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
                      </td>
                      <td className="muted">{d.submarket ?? "—"}</td>
                      <td>
                        <input
                          type="date"
                          value={(d.compType === "sale" ? d.closedOn : d.dateCommenced) ?? ""}
                          onChange={(e) =>
                            update(
                              i,
                              d.compType === "sale"
                                ? { closedOn: e.target.value || null }
                                : { dateCommenced: e.target.value || null }
                            )
                          }
                        />
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
