import { getServiceClient } from "@/lib/supabase";
import { ASSET_CLASS_LABELS } from "@/lib/deals";
import { isUsableForDistance } from "@/lib/geocode";
import { rateSummary } from "@/lib/comps/rates";
import Nav from "@/components/Nav";
import CompIntakeForm from "@/components/CompIntakeForm";
import CompEditor, { type CompRow } from "@/components/CompEditor";
import CompsMap, { type CompMapRow } from "@/components/CompsMap";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

const SQFT_PER_ACRE = 43560;

function fmtUsd(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `$${Math.round(v).toLocaleString()}`;
}

// A comp's headline unit, in the terms the market quotes it in: sales per SF of
// building, leases per SF of building per month. Both are derived from the raw
// figures rather than stored, so a corrected area immediately corrects the rate.
function unitRate(c: any): string {
  if (c.comp_type === "sale") {
    if (c.sale_price && c.building_sf) return `$${(c.sale_price / c.building_sf).toFixed(2)}/SF`;
    if (c.sale_price && c.lot_sf) return `$${(c.sale_price / c.lot_sf).toFixed(2)}/SF land`;
    return "—";
  }
  if (!c.rent) return "—";
  // All three views, so the list can be read by someone thinking in per-acre
  // (IOS) and someone thinking in $/SF/yr (industrial) without either doing
  // arithmetic. Views that can't be derived are simply absent.
  return rateSummary(c);
}

export default async function CompsPage() {
  const supabase = getServiceClient();

  const [{ data: comps }, { data: props }] = await Promise.all([
    supabase
      .from("comps")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300),
    // Markets already in use, so intake can offer them rather than inviting a
    // fresh spelling of "Houston".
    supabase.from("properties").select("market").not("market", "is", null),
  ]);

  const rows = comps ?? [];
  const markets = Array.from(new Set((props ?? []).map((p: any) => p.market).filter(Boolean))).sort();

  const sales = rows.filter((c: any) => c.comp_type === "sale");
  const leases = rows.filter((c: any) => c.comp_type === "lease");
  const unmatched = rows.filter((c: any) => !isUsableForDistance(c.geocode_precision));

  return (
    <>
      <Nav active="comps" />
      <main className="wide">
        <div className="page-header">
          <div>
            <h1>Comps</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              Lease and sale comps, matched to a subject property by distance, size, and recency.
            </p>
          </div>
        </div>

        <div className="stat-grid stat-grid-3">
          <div className="stat-tile">
            <span className="stat-value">{sales.length}</span>
            <span className="stat-label">Sale comps</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{leases.length}</span>
            <span className="stat-label">Lease comps</span>
          </div>
          <div className="stat-tile">
            <span className={unmatched.length ? "stat-value stat-bad" : "stat-value"}>
              {unmatched.length}
            </span>
            <span className="stat-label">Not distance-matchable</span>
            {unmatched.length > 0 && (
              <span className="stat-delta stat-delta-bad">address too vague to geocode</span>
            )}
          </div>
        </div>

        <CompsMap comps={rows as CompMapRow[]} />

        <CompIntakeForm markets={markets} />

        {/* The full table is collapsed by default -- the map is the way in, and
            this is here for the detail and the Edit buttons. */}
        <details className="panel">
          <summary style={{ cursor: "pointer", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted)", fontWeight: 600 }}>
            All comps, in full ({rows.length}) — for editing and detail
          </summary>
          {rows.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>
              No comps yet. Paste a broker&apos;s comp table above and it&apos;ll land here.
            </p>
          ) : (
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table className="summary-table log-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Address</th>
                    <th>City</th>
                    <th>Market</th>
                    <th>Date</th>
                    <th>Price / Rent</th>
                    <th>Rate</th>
                    <th>Bldg SF</th>
                    <th>Acres</th>
                    <th>Yard ac</th>
                    <th>Cov.</th>
                    <th>Clear</th>
                    <th>Surface</th>
                    <th>Tenant / Buyer</th>
                    <th>Yr</th>
                    <th>Class</th>
                    <th>Geo</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c: any) => {
                    const date = c.comp_type === "sale" ? c.closed_on : c.date_commenced;
                    const acres = c.lot_sf ? (c.lot_sf / SQFT_PER_ACRE).toFixed(2) : null;
                    return (
                      <tr key={c.id}>
                        <td>
                          <span className="doc-type">{c.comp_type === "sale" ? "SALE" : "LEASE"}</span>
                        </td>
                        <td>{c.address}</td>
                        <td>{c.city ?? "—"}</td>
                        <td>{c.market ?? "—"}</td>
                        <td>
                          {date ?? "—"}
                          {c.date_precision && c.date_precision !== "day" && (
                            <span className="muted"> ({c.date_precision})</span>
                          )}
                        </td>
                        <td>{c.comp_type === "sale" ? fmtUsd(c.sale_price) : fmtUsd(c.rent)}</td>
                        <td>{unitRate(c)}</td>
                        <td>{c.building_sf ? Math.round(c.building_sf).toLocaleString() : "—"}</td>
                        <td>{acres ?? "—"}</td>
                        <td>{c.yard_acres ?? "—"}</td>
                        <td>
                          {c.coverage_pct === null || c.coverage_pct === undefined
                            ? "—"
                            : `${(c.coverage_pct * 100).toFixed(1)}%`}
                        </td>
                        <td>{c.clear_height_ft ? `${c.clear_height_ft}'` : "—"}</td>
                        <td>
                          {c.surface_type ? c.surface_type.replace(/_/g, " ") : "—"}
                          {c.fenced === true && <span className="doc-type" style={{ marginLeft: 4 }}>FENCED</span>}
                        </td>
                        <td>{(c.comp_type === "sale" ? c.buyer : c.tenant_name) ?? "—"}</td>
                        <td>{c.year_built ?? "—"}</td>
                        <td>{c.asset_class ? ASSET_CLASS_LABELS[c.asset_class] : "—"}</td>
                        <td>
                          {isUsableForDistance(c.geocode_precision) ? (
                            <span className="muted">{c.geocode_precision?.replace(/_/g, " ")}</span>
                          ) : (
                            <span className="overdue">{c.geocode_precision ?? "none"}</span>
                          )}
                        </td>
                        <td>
                          <CompEditor comp={c as CompRow} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </details>
      </main>
    </>
  );
}
