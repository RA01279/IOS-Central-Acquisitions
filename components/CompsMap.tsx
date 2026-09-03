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

const SALE_COLOR = "1E7A46"; // green
const LEASE_COLOR = "2E6DA4"; // blue
const SQFT_PER_ACRE = 43560;

export interface CompMapRow {
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
  const [types, setTypes] = useState<{ sale: boolean; lease: boolean }>({ sale: true, lease: true });

  const markets = useMemo(
    () => Array.from(new Set(comps.map((c) => c.market).filter(Boolean) as string[])).sort(),
    [comps]
  );

  // A comp with no coordinates can't be drawn. Counted rather than dropped
  // silently, so a batch that won't map is visible.
  const mappable = useMemo(() => comps.filter((c) => c.latitude != null && c.longitude != null), [comps]);
  const unmappable = comps.length - mappable.length;

  const filtered = useMemo(
    () =>
      mappable.filter(
        (c) => (market === "__all" || c.market === market) && types[c.comp_type]
      ),
    [mappable, market, types]
  );

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
        points={points}
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

      <p className="hint" style={{ marginTop: 10 }}>
        Hover a pin for the numbers, click it to open the comp. Scroll to zoom, drag to pan.
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
