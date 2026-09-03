import Link from "next/link";
import { notFound } from "next/navigation";
import { getServiceClient } from "@/lib/supabase";
import { ASSET_CLASS_LABELS } from "@/lib/deals";
import { isUsableForDistance } from "@/lib/geocode";
import Nav from "@/components/Nav";
import BackButton from "@/components/BackButton";
import CompEditor, { type CompRow } from "@/components/CompEditor";
import MapView, { type MapPoint } from "@/components/MapView";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

const SQFT_PER_ACRE = 43560;
const SALE_COLOR = "1E7A46";
const LEASE_COLOR = "2E6DA4";

function usd(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `$${Math.round(Number(v)).toLocaleString()}`;
}
function pct(v: number | null | undefined, dp = 1) {
  return v === null || v === undefined ? "—" : `${(Number(v) * 100).toFixed(dp)}%`;
}
function num(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : Math.round(Number(v)).toLocaleString();
}
function yesNo(v: boolean | null | undefined) {
  return v === null || v === undefined ? "—" : v ? "Yes" : "No";
}

/** Straight-line miles, for the nearby-comps list. */
function miles(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 3958.8;
  const r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const q =
    Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

/** The headline unit, in the terms the market quotes it in. Derived, not stored. */
function rate(c: any): string {
  if (c.comp_type === "sale") {
    if (c.sale_price && c.building_sf) return `$${(c.sale_price / c.building_sf).toFixed(2)} / SF building`;
    if (c.sale_price && c.lot_sf) return `$${(c.sale_price / c.lot_sf).toFixed(2)} / SF land`;
    return "—";
  }
  if (!c.rent) return "—";
  switch (c.rent_basis) {
    case "total_monthly":
      return c.building_sf
        ? `$${(c.rent / c.building_sf).toFixed(2)} / SF / mo`
        : `${usd(c.rent)} / mo total`;
    case "per_sf_bldg_monthly":
      return `$${Number(c.rent).toFixed(2)} / SF / mo`;
    case "per_sf_bldg_annual":
      return `$${Number(c.rent).toFixed(2)} / SF / yr  ($${(Number(c.rent) / 12).toFixed(2)} / mo)`;
    case "per_acre_monthly":
      return `$${Number(c.rent).toLocaleString()} / acre / mo`;
    case "per_sf_land_monthly":
      return `$${Number(c.rent).toFixed(3)} / SF land / mo`;
    default:
      return usd(c.rent);
  }
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <span className="label">{label}</span>
      <span className={highlight ? "value highlight" : "value"}>{value}</span>
    </div>
  );
}

export default async function CompDetailPage({ params }: { params: { id: string } }) {
  const supabase = getServiceClient();
  const { data: comp } = await supabase.from("comps").select("*").eq("id", params.id).maybeSingle();
  if (!comp) return notFound();

  const isSale = comp.comp_type === "sale";
  const acres = comp.lot_sf ? Number(comp.lot_sf) / SQFT_PER_ACRE : null;
  const date = isSale ? comp.closed_on : comp.date_commenced;

  // Nearby comps of the same type, nearest first -- the immediate "what else
  // traded around here" question, answered without leaving the page.
  const { data: others } = await supabase
    .from("comps")
    .select("id, address, project_name, comp_type, latitude, longitude, sale_price, rent, rent_basis, building_sf, closed_on, date_commenced")
    .eq("comp_type", comp.comp_type)
    .neq("id", comp.id)
    .not("latitude", "is", null);

  const nearby =
    comp.latitude != null && comp.longitude != null
      ? (others ?? [])
          .map((o: any) => ({
            ...o,
            distanceMi: miles(Number(comp.latitude), Number(comp.longitude), Number(o.latitude), Number(o.longitude)),
          }))
          .sort((a, b) => a.distanceMi - b.distanceMi)
          .slice(0, 6)
      : [];

  const points: MapPoint[] = [];
  if (comp.latitude != null && comp.longitude != null) {
    points.push({
      id: comp.id,
      lat: Number(comp.latitude),
      lng: Number(comp.longitude),
      color: isSale ? SALE_COLOR : LEASE_COLOR,
      title: comp.address,
      emphasis: true,
      lines: [rate(comp)],
    });
    for (const n of nearby) {
      points.push({
        id: n.id,
        lat: Number(n.latitude),
        lng: Number(n.longitude),
        color: isSale ? SALE_COLOR : LEASE_COLOR,
        title: n.address,
        href: `/comps/${n.id}`,
        lines: [`${n.distanceMi.toFixed(1)} mi away`],
      });
    }
  }

  return (
    <>
      <Nav active="comps" />
      <main className="deal-detail">
        <BackButton />

        <div className="deal-header">
          <div>
            <h1>{comp.address}</h1>
            <p className="muted">
              {[comp.project_name, comp.suite].filter(Boolean).join(" · ")}
              {comp.project_name || comp.suite ? " · " : ""}
              {[comp.submarket, comp.city, comp.market].filter(Boolean).join(" · ") || "—"}
              {comp.asset_class ? ` · ${ASSET_CLASS_LABELS[comp.asset_class]}` : ""}
            </p>
          </div>
          <span className="stage-badge">{isSale ? "Sale comp" : "Lease comp"}</span>
        </div>

        {!isUsableForDistance(comp.geocode_precision) && (
          <div className="archived-banner">
            This comp isn&apos;t precisely located ({comp.geocode_precision ?? "no geocode"}), so it
            can&apos;t take part in distance matching. Fix the address below to place it.
          </div>
        )}

        <section className="panel">
          <h2>{isSale ? "Sale" : "Lease"}</h2>
          <div className="metrics-grid">
            {isSale ? (
              <>
                <Metric label="Sale price" value={usd(comp.sale_price)} highlight />
                <Metric label="Rate" value={rate(comp)} highlight />
                <Metric
                  label="Closed"
                  value={
                    date
                      ? `${date}${comp.date_precision && comp.date_precision !== "day" ? ` (${comp.date_precision})` : ""}`
                      : "—"
                  }
                />
                <Metric label="Cap rate" value={pct(comp.cap_rate, 2)} />
                <Metric label="NOI" value={usd(comp.noi)} />
                <Metric label="Occupancy at sale" value={pct(comp.occupancy_at_sale)} />
                <Metric label="Buyer" value={comp.buyer ?? "—"} />
                <Metric label="Seller" value={comp.seller ?? "—"} />
                <Metric label="Broker" value={comp.sale_broker ?? "—"} />
              </>
            ) : (
              <>
                <Metric label="Rent" value={usd(comp.rent)} highlight />
                <Metric label="Rate" value={rate(comp)} highlight />
                <Metric
                  label="Commenced"
                  value={
                    date
                      ? `${date}${
                          comp.date_estimated
                            ? " (estimated)"
                            : comp.date_precision && comp.date_precision !== "day"
                              ? ` (${comp.date_precision})`
                              : ""
                        }`
                      : "—"
                  }
                />
                <Metric label="Expires" value={comp.lease_expires_on ?? "—"} />
                {/* Base rent without CAM understates a rent-roll comp against
                    a broker's gross quote. */}
                <Metric
                  label="CAM"
                  value={comp.cam_psf_annual ? `$${Number(comp.cam_psf_annual).toFixed(2)}/SF/yr` : "—"}
                />
                <Metric
                  label="Term"
                  value={comp.lease_term_months ? `${comp.lease_term_months} months` : "—"}
                />
                <Metric
                  label="Structure"
                  value={comp.lease_type ? comp.lease_type.replace(/_/g, " ").toUpperCase() : "—"}
                />
                <Metric label="Tenant" value={comp.tenant_name ?? "—"} />
                <Metric label="Landlord" value={comp.landlord_name ?? "—"} />
                <Metric
                  label="Escalations"
                  value={comp.escalations_pct ? `${comp.escalations_pct}% / yr` : "—"}
                />
                <Metric
                  label="Free rent"
                  value={comp.free_rent_months ? `${comp.free_rent_months} months` : "—"}
                />
                <Metric label="TI" value={comp.ti_psf ? `$${comp.ti_psf} / SF` : "—"} />
                <Metric label="Renewal options" value={comp.renewal_options ?? "—"} />
                <Metric label="Listing broker" value={comp.listing_broker ?? "—"} />
                <Metric label="Tenant rep" value={comp.tenant_rep_broker ?? "—"} />
              </>
            )}
          </div>
        </section>

        <section className="panel">
          <h2>Site</h2>
          <div className="metrics-grid">
            <Metric label="Building SF" value={num(comp.building_sf)} />
            <Metric label="Site acres" value={acres ? acres.toFixed(2) : "—"} />
            <Metric
              label="Usable yard acres"
              value={comp.yard_acres ? Number(comp.yard_acres).toFixed(2) : "—"}
            />
            <Metric label="Coverage" value={pct(comp.coverage_pct)} />
            <Metric label="Year built" value={comp.year_built ?? "—"} />
            <Metric
              label="Clear height"
              value={comp.clear_height_ft ? `${comp.clear_height_ft}'` : "—"}
            />
            <Metric label="Office SF" value={num(comp.office_sf)} />
            <Metric
              label="Yard surface"
              value={comp.surface_type ? comp.surface_type.replace(/_/g, " ") : "—"}
            />
            <Metric label="Fenced" value={yesNo(comp.fenced)} />
            <Metric label="Outdoor storage permitted" value={yesNo(comp.outdoor_storage_permitted)} />
            <Metric label="Trailer stalls" value={comp.trailer_stalls ?? "—"} />
            <Metric label="Dock-high doors" value={comp.dock_high_doors ?? "—"} />
            <Metric label="Grade-level doors" value={comp.grade_level_doors ?? "—"} />
            <Metric label="Power" value={comp.power_amps ? `${comp.power_amps} A` : "—"} />
            <Metric label="Zoning" value={comp.zoning ?? "—"} />
            <Metric
              label="Occupancy"
              value={comp.occupancy_status ? comp.occupancy_status : "—"}
            />
            <Metric
              label="Tenancy"
              value={comp.tenancy ? comp.tenancy.replace(/_/g, "-") : "—"}
            />
          </div>
          {comp.notes && <p className="hint">{comp.notes}</p>}
          <div style={{ marginTop: 12 }}>
            <CompEditor comp={comp as CompRow} />
          </div>
        </section>

        {points.length > 0 && (
          <section className="panel">
            <h2>
              Location{nearby.length > 0 && <span className="count">{nearby.length} nearby</span>}
            </h2>
            <MapView points={points} height={380} />
            <p className="hint" style={{ marginTop: 10 }}>
              This comp is outlined in white. Nearby {isSale ? "sales" : "leases"} are clickable.
            </p>
          </section>
        )}

        {nearby.length > 0 && (
          <section className="panel">
            <h2>Nearest {isSale ? "sales" : "leases"}</h2>
            <ul className="doc-list">
              {nearby.map((n: any) => {
                const nDate = isSale ? n.closed_on : n.date_commenced;
                const nRate = rate(n);
                return (
                  <li key={n.id}>
                    <Link href={`/comps/${n.id}`}>
                      <strong>{n.address}</strong>
                    </Link>
                    <span className="muted">
                      {" "}
                      · {n.distanceMi.toFixed(1)} mi
                      {nRate !== "—" ? ` · ${nRate}` : ""}
                      {nDate ? ` · ${nDate}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="panel">
          <h2>Provenance</h2>
          <div className="metrics-grid">
            <Metric label="Source" value={comp.source ?? "—"} />
            <Metric label="From" value={comp.source_ref ?? "—"} />
            <Metric label="Added by" value={comp.created_by ?? "—"} />
            <Metric
              label="Added"
              value={comp.created_at ? new Date(comp.created_at).toLocaleDateString() : "—"}
            />
            <Metric label="Status" value={comp.status ?? "—"} />
            <Metric
              label="Geocode"
              value={comp.geocode_precision ? comp.geocode_precision.replace(/_/g, " ") : "none"}
            />
            {comp.updated_at && (
              <Metric
                label="Last edited"
                value={`${new Date(comp.updated_at).toLocaleDateString()}${comp.updated_by ? ` · ${comp.updated_by}` : ""}`}
              />
            )}
          </div>
        </section>
      </main>
    </>
  );
}
