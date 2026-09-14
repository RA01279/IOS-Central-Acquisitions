"use client";
// components/CompsMap.tsx
//
// The comp repository as a map: pick a market, or show everything. Sale and
// lease are different colours, and each pin's popup carries the numbers you'd
// otherwise have gone to a table for.
//
// Filtering happens client-side over the full set. The repository is in the
// hundreds, not the millions, so a round trip per filter change would add
// latency for nothing.

import { useMemo, useState } from "react";
import MapView, { type MapPoint } from "./MapView";
import { hasMapCoordinates as validMapCoordinates } from "@/lib/comps/mapData";
import { isUsableForDistance } from "@/lib/geocode";
import Link from "next/link";
import { haversineMiles } from "@/lib/comps/match";

const SALE_COLOR = "1E7A46"; // green
const LEASE_COLOR = "2E6DA4"; // blue
const SQFT_PER_ACRE = 43560;

function hasMapCoordinates(value: { latitude: unknown; longitude: unknown; geocode_precision?: string | null }) {
  return validMapCoordinates(value) && isUsableForDistance(value.geocode_precision);
}

export interface CompMapRow {
  geocode_precision?: string | null;
  id: string;
  comp_type: "lease" | "sale";
  address: string;
  project_name: string | null;
  city: string | null;
  market: string | null;
  submarket: string | null;
  latitude: number | null;
  longitude: number | null;
  building_sf: number | null;
  lot_sf: number | null;
  coverage_pct: number | null;
  sale_price: number | null;
  rent: number | null;
  rent_basis: string | null;
  closed_on: string | null;
  date_commenced: string | null;
  tenant_name: string | null;
  buyer: string | null;
}

function usd(v: number | null | undefined) {
  return v === null || v === undefined ? null : `$${Math.round(v).toLocaleString()}`;
}

/** The headline unit, in the terms the market quotes it in. */
function rate(c: CompMapRow): string | null {
  if (c.comp_type === "sale") {
    if (c.sale_price && c.building_sf) return `$${(c.sale_price / c.building_sf).toFixed(2)}/SF`;
    if (c.sale_price && c.lot_sf) return `$${(c.sale_price / c.lot_sf).toFixed(2)}/SF land`;
    return null;
  }
  if (!c.rent) return null;
  switch (c.rent_basis) {
    case "total_monthly":
      return c.building_sf ? `$${(c.rent / c.building_sf).toFixed(2)}/SF/mo` : `${usd(c.rent)}/mo`;
    case "per_sf_bldg_monthly":
      return `$${Number(c.rent).toFixed(2)}/SF/mo`;
    case "per_sf_bldg_annual":
      return `$${Number(c.rent).toFixed(2)}/SF/yr`;
    case "per_acre_monthly":
      return `$${Number(c.rent).toLocaleString()}/ac/mo`;
    case "per_sf_land_monthly":
      return `$${Number(c.rent).toFixed(3)}/SF land/mo`;
    default:
      return usd(c.rent);
  }
}

export default function CompsMap({ comps }: { comps: CompMapRow[] }) {
  const [market, setMarket] = useState<string>("__all");
  const [address, setAddress] = useState("");
  const [subject, setSubject] = useState<{ latitude: number; longitude: number; address: string } | null>(null);
  const [minMiles, setMinMiles] = useState("0");
  const [maxMiles, setMaxMiles] = useState("10");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const bandValid = minMiles.trim() !== "" && maxMiles.trim() !== "" && Number.isFinite(Number(minMiles)) && Number.isFinite(Number(maxMiles)) && Number(minMiles) >= 0 && Number(maxMiles) > Number(minMiles) && Number(maxMiles) <= 500;

  async function searchAddress(event: React.FormEvent) {
    event.preventDefault();
    if (!address.trim() || !bandValid || searching) return;
    setSearching(true);
    setSearchError(null);
    setSubject(null);
    try {
      const response = await fetch("/api/comps/search-address", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: address.trim() }) });
      const result = await response.json();
      if (!response.ok || !result.location || !hasMapCoordinates(result.location)) throw new Error(result.error || result.message || "Could not locate this address.");
      setSubject({ ...result.location, address: result.matchedAddress || address.trim() });
      setMarket("__all");
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Address lookup failed. Please retry.");
    } finally {
      setSearching(false);
    }
  }
  const [types, setTypes] = useState<{ sale: boolean; lease: boolean }>({ sale: true, lease: true });

  const markets = useMemo(
    () => Array.from(new Set(comps.map((c) => c.market).filter(Boolean) as string[])).sort(),
    [comps]
  );

  // A comp with no coordinates can't be drawn. Counted rather than dropped
  // silently, so a batch that won't map is visible.
  const mappable = useMemo(() => comps.filter(hasMapCoordinates), [comps]);
  const unmappable = comps.length - mappable.length;

  // A comp with no MARKET is a subtler way to disappear: it has coordinates and
  // draws fine under "All markets", but the dropdown is built from the market
  // values present, so picking any market hides it and nothing says so. Eight
  // Savannah suites sat in that hole -- on the map, invisible the moment a
  // filter was applied. They now get their own option and a count.
  const marketless = useMemo(() => mappable.filter((c) => !c.market).length, [mappable]);

  const filtered = useMemo(
    () =>
      mappable.filter(
        (c) =>
          (market === "__all" ||
            (market === "__none" ? !c.market : c.market === market)) &&
          types[c.comp_type] && (!subject || (bandValid && haversineMiles(subject.latitude, subject.longitude, Number(c.latitude), Number(c.longitude)) >= Number(minMiles) && haversineMiles(subject.latitude, subject.longitude, Number(c.latitude), Number(c.longitude)) <= Number(maxMiles)))
      ).sort((a, b) => subject ? haversineMiles(subject.latitude, subject.longitude, Number(a.latitude), Number(a.longitude)) - haversineMiles(subject.latitude, subject.longitude, Number(b.latitude), Number(b.longitude)) : 0),
    [mappable, market, types, subject, bandValid, minMiles, maxMiles]
  );

  const radiusBand = useMemo(() => subject && bandValid ? { lat: subject.latitude, lng: subject.longitude, minMiles: Number(minMiles), maxMiles: Number(maxMiles) } : undefined, [subject, bandValid, minMiles, maxMiles]);

  const points: MapPoint[] = useMemo(
    () =>
      filtered.map((c) => {
        const acres = c.lot_sf ? (c.lot_sf / SQFT_PER_ACRE).toFixed(2) : null;
        const date = c.comp_type === "sale" ? c.closed_on : c.date_commenced;
        const who = c.comp_type === "sale" ? c.buyer : c.tenant_name;
        return {
          id: c.id,
          lat: Number(c.latitude),
          lng: Number(c.longitude),
          color: c.comp_type === "sale" ? SALE_COLOR : LEASE_COLOR,
          title: c.project_name ? `${c.address} — ${c.project_name}` : c.address,
          href: `/comps/${c.id}`,
          lines: [
            [
              c.comp_type === "sale" ? "Sale" : "Lease",
              date ?? null,
              c.comp_type === "sale" ? usd(c.sale_price) : null,
              rate(c),
            ]
              .filter(Boolean)
              .join(" · "),
            [
              c.building_sf ? `${Math.round(c.building_sf).toLocaleString()} SF` : null,
              acres ? `${acres} ac` : null,
              c.coverage_pct != null ? `${(c.coverage_pct * 100).toFixed(1)}% cov` : null,
            ]
              .filter(Boolean)
              .join(" · "),
            [who, c.submarket ?? c.city].filter(Boolean).join(" · "),
          ].filter((l) => l.length > 0),
        };
      }),
    [filtered]
  );

  const saleCount = filtered.filter((c) => c.comp_type === "sale").length;
  const leaseCount = filtered.filter((c) => c.comp_type === "lease").length;

  return (
    <section className="panel">
      <h2>
        Comps map <span className="count">{filtered.length}</span>
      </h2>

      <form onSubmit={searchAddress} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", marginBottom: 12 }}>
        <label style={{ flex: "1 1 300px" }}>Subject address
          <input aria-label="Subject address" placeholder="Street address, city, state" value={address} maxLength={300} disabled={searching} onChange={e => { setAddress(e.target.value); setSubject(null); setSearchError(null); }} required />
        </label>
        <label>Minimum miles<input aria-label="Minimum miles" type="number" min="0" max="499" step="any" value={minMiles} onChange={e => setMinMiles(e.target.value)} style={{ width: 110 }} required /></label>
        <label>Maximum miles<input aria-label="Maximum miles" type="number" min="0.1" max="500" step="any" value={maxMiles} onChange={e => setMaxMiles(e.target.value)} style={{ width: 110 }} required /></label>
        <button type="submit" disabled={searching || !address.trim() || !bandValid}>{searching ? "Locating…" : "Find comps"}</button>
        {subject && <button type="button" className="secondary" onClick={() => { setSubject(null); setAddress(""); setSearchError(null); }}>Clear radius search</button>}
      </form>
      {!bandValid && <p className="error">Enter a band from zero to 500 miles, with the maximum greater than the minimum.</p>}
      {searchError && <p className="error" role="alert">{searchError}</p>}
      {subject ? <p role="status">{saleCount} sale and {leaseCount} lease comps within {minMiles}–{maxMiles} miles of <strong>{subject.address}</strong>.</p> : <p className="hint">Enter an address to search by straight-line distance. Use 0–5 miles for a radius, or 5–10 miles for a band.</p>}

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
            {m} <span className="muted">{comps.filter((c) => c.market === m).length}</span>
          </button>
        ))}
        {/* Only appears when there's something in it, and then it's the one
            chip you want to click. */}
        {marketless > 0 && (
          <button
            type="button"
            className={market === "__none" ? "chip chip-active" : "chip"}
            onClick={() => setMarket("__none")}
            title="These have coordinates and map fine, but no market — so every other filter hides them. Worth giving them one."
          >
            No market <span className="muted">{marketless}</span>
          </button>
        )}
      </div>

      <div className="filter-chips">
        <button
          type="button"
          className={types.sale ? "chip chip-active" : "chip"}
          onClick={() => setTypes((t) => ({ ...t, sale: !t.sale }))}
        >
          <span className="map-legend-dot" style={{ background: `#${SALE_COLOR}` }} /> Sale
        </button>
        <button
          type="button"
          className={types.lease ? "chip chip-active" : "chip"}
          onClick={() => setTypes((t) => ({ ...t, lease: !t.lease }))}
        >
          <span className="map-legend-dot" style={{ background: `#${LEASE_COLOR}` }} /> Lease
        </button>
      </div>

      <MapView
        points={subject ? [...points, { id: "subject", lat: subject.latitude, lng: subject.longitude, title: subject.address, color: "C07824", emphasis: true }] : points}
        radiusBand={radiusBand}
        legend={[
          { label: "Sale", color: SALE_COLOR, count: saleCount },
          { label: "Lease", color: LEASE_COLOR, count: leaseCount },
        ]}
        height={520}
        emptyMessage={
          comps.length === 0
            ? "No comps yet — add some above and they'll appear here."
            : "No comps match this filter."
        }
      />

      {subject && (filtered.length ? <div className="table-scroll" style={{ marginTop: 16 }}><table className="summary-table log-table">
        <thead><tr><th>Distance</th><th>Type</th><th>Address</th><th>Date</th><th>Price / Rent</th><th>Rate</th><th>Bldg SF</th><th>Acres</th></tr></thead>
        <tbody>{filtered.map(c => <tr key={c.id}>
          <td>{haversineMiles(subject.latitude, subject.longitude, Number(c.latitude), Number(c.longitude)).toFixed(2)} mi</td>
          <td>{c.comp_type === "sale" ? "Sale" : "Lease"}</td><td><Link href={`/comps/${c.id}`}>{c.address}</Link>{c.city ? `, ${c.city}` : ""}</td>
          <td>{(c.comp_type === "sale" ? c.closed_on : c.date_commenced) || "—"}</td><td>{usd(c.comp_type === "sale" ? c.sale_price : c.rent) || "—"}</td><td>{rate(c) || "—"}</td>
          <td>{c.building_sf ? Number(c.building_sf).toLocaleString() : "—"}</td><td>{c.lot_sf ? (c.lot_sf / SQFT_PER_ACRE).toFixed(2) : "—"}</td>
        </tr>)}</tbody>
      </table></div> : <p className="muted">No comps match this radius band and the selected filters. Widen the band or change the filters.</p>)}

      <p className="hint" style={{ marginTop: 10 }}>
        Hover a pin for the numbers, click it to open the comp. Scroll to zoom, drag to pan. Use the layers control (top right) to switch to satellite.
        {unmappable > 0 && (
          <>
            {" "}
            <span className="overdue">
              {unmappable} comp{unmappable === 1 ? "" : "s"} can&apos;t be mapped
            </span>{" "}
            — the address was too vague to geocode. Fix the address in the list below to place them.
          </>
        )}
      </p>
    </section>
  );
}
