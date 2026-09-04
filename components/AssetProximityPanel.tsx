"use client";
// components/AssetProximityPanel.tsx
//
// This prospect against what we already own, on one map.
//
// The question it answers is the one asked in every screening conversation:
// have we been here before? An asset two miles away means we know the
// submarket, the tenants and what the yards rent for -- and it may mean a
// tenant expansion rather than a new relationship. It can also mean the
// opposite, that we're already long this pocket.
//
// Lease and sale comps are a layer you turn on, not the default. Forty assets
// and four hundred comps on one map is a smear; the assets are the point here
// and the comps are there when you want to see the evidence around them.

import { useMemo, useState } from "react";
import Link from "next/link";
import MapView, { type MapPoint } from "./MapView";
import { rateSummary } from "@/lib/comps/rates";

const SUBJECT_COLOR = "FF5A4E";
const ASSET_COLOR = "6C4AB6";
const ASSET_AVAIL_COLOR = "C77DFF";
const LEASE_COLOR = "2E6DA4";
const SALE_COLOR = "1E7A46";

const RADII = [10, 25, 50, 100, 0]; // 0 = no limit

/**
 * Close enough to be the same site rather than a neighbour.
 *
 * ~800 feet: tight enough that nothing across the street qualifies, loose
 * enough to absorb the gap between a rooftop geocode and a parcel centroid for
 * the same address.
 *
 * This is not a hypothetical. Eight live pipeline deals sit on sites already in
 * the portfolio -- 2720 Industrial Ln, 9773 Harry Hines Blvd, 9090 Forney Rd,
 * 2833 Westside Dr and others. Reporting those as "0.0 mi away" reads like a
 * rounding bug when the actual fact is far more useful: this is ours already,
 * so the deal is an expansion, a re-lease, or a pipeline row that closed and
 * was never moved on.
 */
const SAME_SITE_MI = 0.15;

export interface AssetRow {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  market: string | null;
  submarket: string | null;
  status: string;
  occupancy: string | null;
  site_acres: number | null;
  building_sf: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface NearbyComp {
  id: string;
  comp_type: "lease" | "sale";
  address: string;
  latitude: number | null;
  longitude: number | null;
  rent: number | null;
  rent_basis: string | null;
  sale_price: number | null;
  building_sf: number | null;
  lot_sf: number | null;
  yard_acres: number | null;
  date_commenced: string | null;
  closed_on: string | null;
  tenant_name: string | null;
  geocode_precision: string | null;
}

/** Straight-line miles. */
function miles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.7613;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const q =
    Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

export default function AssetProximityPanel({
  assets,
  comps,
  subjectLat,
  subjectLng,
  subjectAddress,
}: {
  assets: AssetRow[];
  comps: NearbyComp[];
  subjectLat: number | null;
  subjectLng: number | null;
  subjectAddress: string;
}) {
  const [radiusMiles, setRadiusMiles] = useState(25);
  const [showLease, setShowLease] = useState(false);
  const [showSale, setShowSale] = useState(false);
  const [includeSold, setIncludeSold] = useState(false);

  const hasSubject = subjectLat != null && subjectLng != null;

  // Assets with a distance, nearest first. Sold ones are held back behind a
  // toggle: still useful history, but not something we own today.
  const ranked = useMemo(() => {
    const out = assets
      .filter((a) => a.latitude != null && a.longitude != null)
      .filter((a) => includeSold || a.status !== "sold")
      .map((a) => ({
        asset: a,
        distanceMi: hasSubject
          ? miles(subjectLat!, subjectLng!, Number(a.latitude), Number(a.longitude))
          : null,
      }));
    out.sort((x, y) => (x.distanceMi ?? Infinity) - (y.distanceMi ?? Infinity));
    return out;
  }, [assets, includeSold, hasSubject, subjectLat, subjectLng]);

  const inRadius = useMemo(
    () =>
      radiusMiles === 0
        ? ranked
        : ranked.filter((r) => r.distanceMi !== null && r.distanceMi <= radiusMiles),
    [ranked, radiusMiles]
  );

  const compsInRadius = useMemo(() => {
    const wanted = comps.filter(
      (c) =>
        c.latitude != null &&
        c.longitude != null &&
        ((showLease && c.comp_type === "lease") || (showSale && c.comp_type === "sale"))
    );
    if (!hasSubject || radiusMiles === 0) return wanted;
    return wanted.filter(
      (c) => miles(subjectLat!, subjectLng!, Number(c.latitude), Number(c.longitude)) <= radiusMiles
    );
  }, [comps, showLease, showSale, hasSubject, subjectLat, subjectLng, radiusMiles]);

  const points: MapPoint[] = useMemo(() => {
    const out: MapPoint[] = [];
    if (hasSubject) {
      out.push({
        id: "__subject",
        lat: subjectLat!,
        lng: subjectLng!,
        color: SUBJECT_COLOR,
        title: `${subjectAddress} (this deal)`,
        emphasis: true,
      });
    }
    // Comps first, so assets and the subject draw over them rather than under.
    for (const c of compsInRadius) {
      const when = c.comp_type === "sale" ? c.closed_on : c.date_commenced;
      out.push({
        id: `comp-${c.id}`,
        lat: Number(c.latitude),
        lng: Number(c.longitude),
        color: c.comp_type === "sale" ? SALE_COLOR : LEASE_COLOR,
        title: c.address,
        href: `/comps/${c.id}`,
        lines: [
          c.comp_type === "sale"
            ? c.sale_price && c.building_sf
              ? `$${(Number(c.sale_price) / Number(c.building_sf)).toFixed(2)}/SF`
              : "Sale comp"
            : rateSummary(c),
          [c.tenant_name, when].filter(Boolean).join(" · "),
        ].filter((l) => l.length > 0),
      });
    }
    for (const { asset, distanceMi } of inRadius) {
      out.push({
        id: `asset-${asset.id}`,
        lat: Number(asset.latitude),
        lng: Number(asset.longitude),
        color: asset.occupancy === "available" ? ASSET_AVAIL_COLOR : ASSET_COLOR,
        title: `${asset.address} (ours)`,
        href: `/assets#${asset.id}`,
        lines: [
          [
            asset.status === "sold" ? "SOLD" : asset.occupancy === "available" ? "Space available" : "Occupied",
            asset.site_acres ? `${asset.site_acres} AC` : null,
          ].filter(Boolean).join(" · "),
          [
            [asset.city, asset.state].filter(Boolean).join(", "),
            distanceMi !== null ? `${distanceMi.toFixed(1)} mi from this deal` : null,
          ].filter(Boolean).join(" · "),
        ].filter((l) => l.length > 0),
      });
    }
    return out;
  }, [hasSubject, subjectLat, subjectLng, subjectAddress, inRadius, compsInRadius]);

  const nearest = ranked[0];
  const availableNearby = inRadius.filter((r) => r.asset.occupancy === "available").length;
  // Assets on this very site, which is a different fact from a nearby one.
  const sameSite = ranked.filter(
    (r) => r.distanceMi !== null && r.distanceMi <= SAME_SITE_MI
  );

  return (
    <section className="panel">
      <h2>
        Our assets nearby <span className="count">{inRadius.length}</span>
      </h2>

      {!hasSubject && (
        <div className="warning">
          This deal&apos;s property has no coordinates, so nothing can be measured against it. The
          whole portfolio is shown below — fix the property address to get distances.
        </div>
      )}

      {/* Said before anything else, because it changes what the deal IS. */}
      {sameSite.length > 0 && (
        <div className="warning" style={{ background: "#ede7f6" }}>
          <p style={{ margin: 0 }}>
            <strong>
              We already own this site
              {sameSite.length > 1 ? ` (${sameSite.length} assets on it)` : ""}.
            </strong>{" "}
            {sameSite.map((r) => r.asset.address).join(", ")} sits within{" "}
            {(sameSite[0].distanceMi! * 5280).toFixed(0)} ft of this deal&apos;s property — so this
            is an expansion, a re-lease, or a pipeline row that closed and never moved on. Worth
            knowing before it&apos;s underwritten as a new acquisition.
          </p>
        </div>
      )}

      {hasSubject && (
        <div className="stat-grid stat-grid-3">
          <div className="stat-tile">
            <span className="stat-value">
              {nearest?.distanceMi == null
                ? "—"
                : nearest.distanceMi <= SAME_SITE_MI
                  ? "Ours"
                  : `${nearest.distanceMi.toFixed(1)} mi`}
            </span>
            <span className="stat-label">
              {nearest?.distanceMi != null && nearest.distanceMi <= SAME_SITE_MI
                ? "This site is already ours"
                : "Nearest asset we own"}
            </span>
            {nearest && <span className="stat-delta">{nearest.asset.address}</span>}
          </div>
          <div className="stat-tile">
            <span className="stat-value">{inRadius.length}</span>
            <span className="stat-label">
              Within {radiusMiles === 0 ? "any distance" : `${radiusMiles} mi`}
            </span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{availableNearby}</span>
            <span className="stat-label">…with space available</span>
            {availableNearby > 0 && (
              <span className="stat-delta">a tenant here may already have options</span>
            )}
          </div>
        </div>
      )}

      <div className="filter-chips">
        <span className="muted" style={{ alignSelf: "center" }}>Within</span>
        {RADII.map((r) => (
          <button
            key={r}
            type="button"
            className={radiusMiles === r ? "chip chip-active" : "chip"}
            onClick={() => setRadiusMiles(r)}
          >
            {r === 0 ? "All" : `${r} mi`}
          </button>
        ))}
      </div>

      <div className="filter-chips">
        <span className="muted" style={{ alignSelf: "center" }}>Layers</span>
        <button
          type="button"
          className={showLease ? "chip chip-active" : "chip"}
          onClick={() => setShowLease((v) => !v)}
        >
          <span className="map-legend-dot" style={{ background: `#${LEASE_COLOR}` }} /> Lease comps
        </button>
        <button
          type="button"
          className={showSale ? "chip chip-active" : "chip"}
          onClick={() => setShowSale((v) => !v)}
        >
          <span className="map-legend-dot" style={{ background: `#${SALE_COLOR}` }} /> Sale comps
        </button>
        <button
          type="button"
          className={includeSold ? "chip chip-active" : "chip"}
          onClick={() => setIncludeSold((v) => !v)}
        >
          Include sold
        </button>
      </div>

      <MapView
        points={points}
        height={440}
        emptyMessage="No assets within this radius. Widen it, or check the property has coordinates."
        legend={[
          ...(hasSubject ? [{ label: "This deal", color: SUBJECT_COLOR }] : []),
          { label: "Ours — occupied", color: ASSET_COLOR },
          { label: "Ours — space available", color: ASSET_AVAIL_COLOR },
          ...(showLease ? [{ label: "Lease comps", color: LEASE_COLOR }] : []),
          ...(showSale ? [{ label: "Sale comps", color: SALE_COLOR }] : []),
        ]}
      />

      {inRadius.length > 0 && (
        <div className="table-scroll" style={{ marginTop: 14 }}>
          <table className="summary-table log-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Distance</th>
                <th>Market</th>
                <th>Acres</th>
                <th>Bldg SF</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {inRadius.slice(0, 25).map(({ asset, distanceMi }) => (
                <tr key={asset.id} style={{ opacity: asset.status === "sold" ? 0.5 : 1 }}>
                  <td>
                    <Link href={`/assets#${asset.id}`}>{asset.address}</Link>
                    <span className="muted">
                      {" "}
                      {[asset.city, asset.state].filter(Boolean).join(", ")}
                    </span>
                  </td>
                  <td>{distanceMi !== null ? `${distanceMi.toFixed(1)} mi` : "—"}</td>
                  <td className="muted">{asset.market ?? "—"}</td>
                  <td>{asset.site_acres ?? "—"}</td>
                  <td>{asset.building_sf ? Math.round(Number(asset.building_sf)).toLocaleString() : "—"}</td>
                  <td className="muted">
                    {asset.status === "sold"
                      ? "sold"
                      : asset.occupancy === "available"
                        ? "space available"
                        : "occupied"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="hint" style={{ marginTop: 10 }}>
        Distances are straight-line from this deal&apos;s property. Acreage and building size are
        blank until someone fills them in — dalfen.com/ios, where the portfolio came from,
        doesn&apos;t publish either. Turn the comp layers on to see what has been leasing and
        trading around the assets.
      </p>
    </section>
  );
}
