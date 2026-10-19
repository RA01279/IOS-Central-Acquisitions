// components/OwnedNearbyCard.tsx
//
// Summary-tab answer to "do we already own anything near this?": the closest
// owned assets with distance, size and whether they have space. The full map,
// sold assets and comps live on the Demand Map tab (AssetProximityPanel).

import Link from "next/link";
import { haversineMiles } from "@/lib/ic-deck/geo";

export type OwnedAsset = {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  status: string;
  occupancy: string | null;
  site_acres: number | null;
  building_sf: number | null;
  latitude: number | null;
  longitude: number | null;
};

const RADIUS_MI = 25;
const SHOW = 5;
// Same site, not a neighbour (matches AssetProximityPanel).
const SAME_SITE_MI = 0.15;

const OCCUPANCY: Record<string, string> = { occupied: "Occupied", available: "Space available", partial: "Partly available" };

export default function OwnedNearbyCard({
  dealId,
  assets,
  lat,
  lng,
}: {
  dealId: string;
  assets: OwnedAsset[];
  lat: number | null;
  lng: number | null;
}) {
  const ranked =
    lat == null || lng == null
      ? []
      : assets
          .filter((a) => a.status === "owned" && a.latitude != null && a.longitude != null)
          .map((a) => ({ a, mi: haversineMiles(lat, lng, Number(a.latitude), Number(a.longitude)) }))
          .sort((x, y) => x.mi - y.mi);
  const near = ranked.filter((r) => r.mi <= RADIUS_MI);
  const withSpace = near.filter((r) => r.a.occupancy === "available" || r.a.occupancy === "partial").length;

  return (
    <div className="card" style={{ gap: 10 }}>
      <div className="card-head">
        <span className="overline">Owned nearby</span>
        <a href={`/deals/${dealId}/demand-map`} className="link-caps">
          Open map
        </a>
      </div>
      {lat == null || lng == null ? (
        <p className="hint" style={{ margin: 0 }}>Pin this property to see what we own near it.</p>
      ) : !near.length ? (
        <p className="hint" style={{ margin: 0 }}>
          Nothing we own within {RADIUS_MI} mi.
          {ranked[0] ? (
            <>
              {" "}Nearest: <Link href={`/assets/${ranked[0].a.id}`}>{ranked[0].a.address}</Link>
              {ranked[0].a.city ? `, ${ranked[0].a.city}` : ""} · {ranked[0].mi.toFixed(0)} mi
            </>
          ) : null}
        </p>
      ) : (
        <>
          <p className="hint" style={{ margin: 0 }}>
            {near.length} owned within {RADIUS_MI} mi
            {withSpace ? ` · ${withSpace} with space available` : ""}
          </p>
          <table className="summary-table">
            <thead>
              <tr><th>Asset</th><th>Distance</th><th>Size</th><th>Occupancy</th></tr>
            </thead>
            <tbody>
              {near.slice(0, SHOW).map(({ a, mi }) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/assets/${a.id}`}>{a.address}</Link>
                    {a.city ? <span className="muted">, {a.city}</span> : null}
                  </td>
                  <td>{mi <= SAME_SITE_MI ? "Same site" : `${mi < 10 ? mi.toFixed(1) : mi.toFixed(0)} mi`}</td>
                  <td>
                    {[
                      a.site_acres ? `${Number(a.site_acres).toFixed(1)} AC` : null,
                      a.building_sf ? `${Math.round(Number(a.building_sf)).toLocaleString()} SF` : null,
                    ].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td>{a.occupancy ? OCCUPANCY[a.occupancy] ?? a.occupancy : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {near.length > SHOW && (
            <a href={`/deals/${dealId}/demand-map`} className="hint">+{near.length - SHOW} more on the map</a>
          )}
        </>
      )}
    </div>
  );
}
