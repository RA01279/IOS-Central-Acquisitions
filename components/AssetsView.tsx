"use client";
// components/AssetsView.tsx
//
// The portfolio map and table, with a market filter and inline editing for the
// figures the source page doesn't publish. Occupancy is a dropdown right in the
// table: changing it saves at once (a tenant left, a vacancy leased), and the
// page's tiles open the table filtered to space available or occupied.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MapView, { type MapPoint } from "./MapView";
import AssetTransactionEditor from "./AssetTransactionEditor";
import { saleComparison } from "@/lib/asset-transactions";

const OCCUPIED_COLOR = "6C4AB6";
const AVAILABLE_COLOR = "C77DFF";
const SOLD_COLOR = "9AA5B1";

export interface AssetDetail {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  market: string | null;
  submarket: string | null;
  asset_class: string;
  status: string;
  occupancy: string | null;
  site_acres: number | null;
  building_sf: number | null;
  latitude: number | null;
  longitude: number | null;
  geocode_precision: string | null;
  notes: string | null;
  source_url: string | null;
  purchase_price: number | null;
  purchased_on: string | null;
  sale_price: number | null;
  sold_on: string | null;
  acquisition_costs: number | null;
  selling_costs: number | null;
  occupancy_set_by?: string | null;
  occupancy_set_at?: string | null;
}

/** Occupancy filter: "space" is anything with room (available or partly leased). */
export type OccupancyFilter = "all" | "space" | "occupied";
const hasSpace = (a: AssetDetail) => a.occupancy === "available" || a.occupancy === "partial";
const OCCUPANCY_LABELS: Record<string, string> = { occupied: "Occupied", partial: "Partly leased", available: "Space available" };

function colorFor(a: AssetDetail): string {
  if (a.status === "sold") return SOLD_COLOR;
  return hasSpace(a) ? AVAILABLE_COLOR : OCCUPIED_COLOR;
}

export default function AssetsView({ assets, initialOccupancy = "all" }: { assets: AssetDetail[]; initialOccupancy?: OccupancyFilter }) {
  const router = useRouter();
  const [occFilter, setOccFilter] = useState<OccupancyFilter>(initialOccupancy);
  // Occupancy saved from the table, shown straight away while the page refreshes.
  const [occSaved, setOccSaved] = useState<Record<string, string>>({});
  const [occBusy, setOccBusy] = useState<string | null>(null);
  const [market, setMarket] = useState("__all");
  const [state, setState] = useState("__all");
  const [city, setCity] = useState("__all");
  const [portfolioFilter, setPortfolioFilter] = useState("owned");
  const includeSold = portfolioFilter !== "owned";
  const [transaction, setTransaction] = useState<{ asset: AssetDetail; recordSale: boolean } | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<{ acres: string; sf: string; submarket: string; notes: string }>(
    { acres: "", sf: "", submarket: "", notes: "" }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markets = useMemo(
    () => Array.from(new Set(assets.map((a) => a.market).filter(Boolean) as string[])).sort(),
    [assets]
  );

  const states = useMemo(() => Array.from(new Set(assets.map(assetState))).sort(), [assets]);
  const cities = useMemo(() => {
    const options = new Map<string, string>();
    for (const asset of assets) {
      if (state !== "__all" && assetState(asset) !== state) continue;
      options.set(assetCity(asset), `${asset.city?.trim() || "City not recorded"}, ${assetState(asset) === "__none" ? "state not recorded" : assetState(asset)}`);
    }
    return Array.from(options, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [assets, state]);

  const shown = useMemo(
    () =>
      assets
        .filter((a) => portfolioFilter === "all" || (portfolioFilter === "sold" ? a.status === "sold" : a.status !== "sold"))
        .filter((a) => market === "__all" || a.market === market)
        .filter((a) => state === "__all" || assetState(a) === state)
        .filter((a) => city === "__all" || assetCity(a) === city)
        .filter((a) => occFilter === "all" || (a.status !== "sold" && (occFilter === "space" ? hasSpace(a) : !hasSpace(a)))),
    [assets, portfolioFilter, market, state, city, occFilter]
  );

  const points: MapPoint[] = useMemo(
    () =>
      shown
        .filter((a) => a.latitude != null && a.longitude != null)
        .map((a) => ({
          id: a.id,
          lat: Number(a.latitude),
          lng: Number(a.longitude),
          color: colorFor(a),
          title: a.address,
          lines: [
            [a.city, a.state].filter(Boolean).join(", "),
            [
              a.status === "sold" ? "SOLD" : OCCUPANCY_LABELS[a.occupancy ?? "occupied"] ?? "Occupied",
              a.site_acres ? `${a.site_acres} AC` : null,
              a.building_sf ? `${Math.round(Number(a.building_sf)).toLocaleString()} SF` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          ].filter((l) => l.length > 0),
        })),
    [shown]
  );

  function startEdit(a: AssetDetail) {
    setEditing(a.id);
    setError(null);
    setForm({
      acres: a.site_acres == null ? "" : String(a.site_acres),
      sf: a.building_sf == null ? "" : String(a.building_sf),
      submarket: a.submarket ?? "",
      notes: a.notes ?? "",
    });
  }

  async function saveOccupancy(a: AssetDetail, occupancy: string) {
    setOccBusy(a.id);
    setError(null);
    setOccSaved((m) => ({ ...m, [a.id]: occupancy }));
    try {
      const res = await fetch(`/api/assets/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occupancy }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save occupancy");
      setSavedMessage(`${a.address}: now ${(OCCUPANCY_LABELS[occupancy] ?? occupancy).toLowerCase()}.`);
      router.refresh();
    } catch (e: any) {
      setOccSaved((m) => { const n = { ...m }; delete n[a.id]; return n; });
      setError(`${a.address}: ${e.message}`);
    } finally {
      setOccBusy(null);
    }
  }

  async function save(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteAcres: form.acres,
          buildingSf: form.sf,
          submarket: form.submarket,
          notes: form.notes,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save");
      setEditing(null);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="panel">
        <h2>
          Portfolio map <span className="count">{points.length}</span>
        </h2>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", marginBottom: 16 }}>
          <label style={{ minWidth: 180 }}>State
            <select value={state} onChange={e => { setState(e.target.value); setCity("__all"); }}>
              <option value="__all">All states</option>
              {states.map(s => <option key={s} value={s}>{s === "__none" ? "State not recorded" : s}</option>)}
            </select>
          </label>
          <label style={{ minWidth: 220 }}>City
            <select value={city} onChange={e => setCity(e.target.value)}>
              <option value="__all">All cities</option>
              {cities.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          {(state !== "__all" || city !== "__all" || market !== "__all") && <button type="button" className="secondary" onClick={() => { setState("__all"); setCity("__all"); setMarket("__all"); }}>Clear geography filters</button>}
        </div>

        <div className="filter-chips">
          <button
            type="button"
            className={market === "__all" ? "chip chip-active" : "chip"}
            onClick={() => setMarket("__all")}
          >
            All markets
          </button>
          {markets.map((m) => (
            <button
              key={m}
              type="button"
              className={market === m ? "chip chip-active" : "chip"}
              onClick={() => setMarket(m)}
            >
              {m}{" "}
              <span className="muted">
                {assets.filter((a) => a.market === m && (state === "__all" || assetState(a) === state) && (city === "__all" || assetCity(a) === city) && (portfolioFilter === "all" || (portfolioFilter === "sold" ? a.status === "sold" : a.status !== "sold"))).length}
              </span>
            </button>
          ))}
          {([["all", "Any occupancy"], ["space", "Space available"], ["occupied", "Occupied"]] as const).map(([value, label]) => <button type="button" key={value} className={occFilter === value ? "chip chip-active" : "chip"} onClick={() => setOccFilter(value)}>{label}</button>)}
          {[ ["owned", "Owned"], ["sold", "Sold history"], ["all", "All assets"] ].map(([value, label]) => <button type="button" key={value} className={portfolioFilter === value ? "chip chip-active" : "chip"} onClick={() => setPortfolioFilter(value)}>{label}</button>)}
        </div>

        <p className="hint" role="status">Showing {shown.length} matching asset{shown.length === 1 ? "" : "s"}. State, city, market, occupancy and ownership filters apply to the map and table.</p>

        <MapView
          points={points}
          height={460}
          emptyMessage="No located assets match these filters. Change or clear the geography filters."
          legend={[
            { label: "Occupied", color: OCCUPIED_COLOR },
            { label: "Space available", color: AVAILABLE_COLOR },
            ...(includeSold ? [{ label: "Sold", color: SOLD_COLOR }] : []),
          ]}
        />
      </section>

      {savedMessage && <p role="status">{savedMessage}</p>}
      {transaction && <AssetTransactionEditor key={`${transaction.asset.id}-${transaction.recordSale}`} asset={transaction.asset} recordSale={transaction.recordSale} onCancel={() => setTransaction(null)} onSaved={status => {
        setSavedMessage(`Purchase and sale details saved for ${transaction.asset.address}.`);
        if (status === "sold" || transaction.asset.status === "sold") setPortfolioFilter("all");
        setTransaction(null); router.refresh();
      }} />}

      <section className="panel" id="assets-table">
        <h2>
          Assets <span className="count">{shown.length}</span>
        </h2>
        {error && <p className="error">{error}</p>}
        <div className="asset-table-container">
          <table className="summary-table log-table asset-table"><colgroup>{[15,8,8,8,5,6,7,9,8,11,15].map((width,index)=><col key={index} style={{width:`${width}%`}} />)}</colgroup>
            <thead>
              <tr>
                <th>Address</th>
                <th>City</th>
                <th>Market</th>
                <th>Submarket</th>
                <th>Acres</th>
                <th>Bldg SF</th>
                <th>Status</th>
                <th>Purchase</th>
                <th>Sale</th>
                <th>Change after costs</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={11} className="muted">No assets match these filters. Change the state, city, market or ownership selection.</td></tr>}
              {shown.map((a) => (
                // id on the row so a map popup or a deal panel can link
                // straight to it with /assets#<id>.
                <tr key={a.id} id={a.id}>
                  <td data-label="Address">
                    <a href={`/assets/${a.id}`}>{a.address}</a>
                    {a.latitude == null && (
                      <span className="muted" title="No coordinates, so it can't be mapped or measured">
                        {" "}
                        · not located
                      </span>
                    )}
                  </td>
                  <td data-label="City" className="muted">{[a.city, a.state].filter(Boolean).join(", ") || "—"}</td>
                  <td data-label="Market" className="muted">{a.market ?? "—"}</td>
                  <td data-label="Submarket">
                    {editing === a.id ? (
                      <input
                        value={form.submarket}
                        onChange={(e) => setForm((f) => ({ ...f, submarket: e.target.value }))}
                        style={{ width: "100%" }}
                      />
                    ) : (
                      <span className="muted">{a.submarket ?? "—"}</span>
                    )}
                  </td>
                  <td data-label="Acres">
                    {editing === a.id ? (
                      <input
                        value={form.acres}
                        onChange={(e) => setForm((f) => ({ ...f, acres: e.target.value }))}
                        placeholder="6.19"
                        style={{ width: "100%" }}
                      />
                    ) : (
                      a.site_acres ?? <span className="overdue">—</span>
                    )}
                  </td>
                  <td data-label="Bldg SF">
                    {editing === a.id ? (
                      <input
                        value={form.sf}
                        onChange={(e) => setForm((f) => ({ ...f, sf: e.target.value }))}
                        placeholder="20200"
                        style={{ width: "100%" }}
                      />
                    ) : a.building_sf ? (
                      Math.round(Number(a.building_sf)).toLocaleString()
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label="Status">
                    {a.status === "sold" ? (
                      <span className="muted">sold</span>
                    ) : (
                      <>
                        <select
                          aria-label={`Occupancy of ${a.address}`}
                          className={`occ-select occ-${occSaved[a.id] ?? a.occupancy ?? "occupied"}`}
                          value={occSaved[a.id] ?? a.occupancy ?? "occupied"}
                          disabled={occBusy === a.id}
                          onChange={(e) => saveOccupancy(a, e.target.value)}
                        >
                          <option value="occupied">Occupied</option>
                          <option value="partial">Partly leased</option>
                          <option value="available">Space available</option>
                        </select>
                        {a.occupancy_set_at ? (
                          <div className="muted" style={{ fontSize: 11 }} title={`Set by ${a.occupancy_set_by ?? "someone"}`}>
                            {(a.occupancy_set_by ?? "").split("@")[0] || "set"} · {new Date(a.occupancy_set_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </div>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td data-label="Purchase">{assetMoney(a.purchase_price)}{a.purchased_on && <div className="muted">{a.purchased_on}</div>}{a.acquisition_costs != null && <div className="muted">+ {assetMoney(a.acquisition_costs)} costs</div>}</td>
                  <td data-label="Sale">{a.status === "sold" ? <>{assetMoney(a.sale_price)}{a.sold_on && <div className="muted">{a.sold_on}</div>}{a.selling_costs != null && <div className="muted">− {assetMoney(a.selling_costs)} costs</div>}</> : "—"}</td>
                  <td data-label="Change after costs">{comparisonLabel(a)}</td>
                  <td data-label="Actions">
                    {editing === a.id ? (
                      <>
                        <button onClick={() => save(a.id)} disabled={busy}>
                          {busy ? "…" : "Save"}
                        </button>{" "}
                        <button type="button" className="secondary" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <><button type="button" className="secondary" onClick={() => startEdit(a)}>
                        Edit
                      </button>{" "}<button type="button" className="secondary" onClick={() => { setEditing(null); setTransaction({ asset: a, recordSale: false }); }}>Purchase / sale</button>{" "}
                      {a.status !== "sold" && <button type="button" onClick={() => { setEditing(null); setTransaction({ asset: a, recordSale: true }); }}>Record sale</button>}</>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Seeded from{" "}
          <a href="https://www.dalfen.com/ios/" target="_blank" rel="noreferrer">
            dalfen.com/ios
          </a>
          , which publishes addresses and occupancy but no acreage or building size. Re-running the
          seed updates occupancy and preserves recorded sales and purchase details.
        </p>
      </section>
    </>
  );
}

function assetState(a: AssetDetail) { return a.state?.trim().toUpperCase() || "__none"; }
function assetCity(a: AssetDetail) { return JSON.stringify([a.city?.trim().toLowerCase() || "", assetState(a)]); }
function assetMoney(value: number | null) { return value == null ? "—" : `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }
function comparisonLabel(asset: AssetDetail) {
  const comparison = saleComparison(asset);
  if (!comparison) return asset.status === "sold" ? "Add purchase and sale prices" : "—";
  return <>{comparison.netChange !== null ? <>{comparison.netChange < 0 ? "−" : "+"}{assetMoney(Math.abs(comparison.netChange))}<div className="muted">{comparison.netPercent! >= 0 ? "+" : ""}{comparison.netPercent!.toFixed(2)}% after costs</div></> : <div className="muted">Add both costs for net change</div>}<div className="muted">Price only: {comparison.change < 0 ? "−" : "+"}{assetMoney(Math.abs(comparison.change))} ({comparison.percent.toFixed(2)}%)</div></>;
}

