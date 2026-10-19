// app/assets/[id]/page.tsx
//
// One owned asset after closing: what we underwrote (the closing deal's model
// and in-place rent) next to what it's doing (the rent roll against what we
// paid), and the rent roll itself with expiry flags.

import Link from "next/link";
import { notFound } from "next/navigation";
import Nav from "@/components/Nav";
import LeasesPanel from "@/components/LeasesPanel";
import { getServiceClient } from "@/lib/supabase";
import { ctToday } from "@/lib/summary";
import { dealRef } from "@/lib/format";
import { performance, type Lease } from "@/lib/asset-performance";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const usd = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);
const pct = (v: number | null | undefined, d = 2) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const yrs = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)} yrs`);
const x = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}x`);

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return { title: "Asset" };
  const { data } = await getServiceClient().from("assets").select("address").eq("id", id).maybeSingle();
  return { title: data?.address ?? "Asset" };
}

export default async function AssetPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return notFound();
  const db = getServiceClient();
  const [{ data: asset, error }, { data: leases, error: leaseError }, { data: deals }] = await Promise.all([
    db.from("assets").select("*").eq("id", id).maybeSingle(),
    db.from("asset_leases").select("*").eq("asset_id", id),
    db.from("deals")
      .select("id, ref, stage, closed_price, closed_on, in_place_rent, in_place_rent_basis, properties(lot_sf, building_sf), uw_versions(version_number, returns_summary)")
      .eq("portfolio_asset_id", id)
      .order("closed_on", { ascending: false, nullsFirst: false }),
  ]);
  if (error) throw new Error(`Loading asset: ${error.message}`);
  if (leaseError) throw new Error(`Loading leases: ${leaseError.message}`);
  if (!asset) return notFound();

  const today = ctToday();
  const deal: any = (deals ?? [])[0] ?? null;
  const latest = deal ? [...(deal.uw_versions ?? [])].sort((a: any, b: any) => b.version_number - a.version_number)[0] : null;
  const perf = performance({
    today,
    asset,
    deal: deal
      ? { closed_price: deal.closed_price, closed_on: deal.closed_on, in_place_rent: deal.in_place_rent, in_place_rent_basis: deal.in_place_rent_basis, lot_sf: deal.properties?.lot_sf ?? null, building_sf: deal.properties?.building_sf ?? null }
      : null,
    returns: latest?.returns_summary ?? null,
    leases: (leases ?? []) as Lease[],
  });
  const ios = asset.asset_class !== "industrial";
  const delta = (a: number | null, b: number | null, fmt: (v: number) => string) =>
    a != null && b != null ? <span className={a < b ? "overdue" : "muted"}>{a >= b ? "+" : ""}{fmt(a - b)}</span> : null;

  return (
    <>
      <Nav active="assets" />
      <main className="wide">
        <div className="page-header">
          <div>
            <p className="crumbs"><Link href="/assets">Our Assets</Link> · {asset.market ?? asset.city ?? "Asset"}</p>
            <h1>{asset.address}</h1>
            <p className="hint" style={{ margin: 0 }}>
              {[asset.city, asset.state].filter(Boolean).join(", ")}
              {" · "}{ios ? "IOS" : "Industrial"}
              {asset.site_acres ? ` · ${Number(asset.site_acres).toFixed(2)} AC` : ""}
              {asset.building_sf ? ` · ${Math.round(asset.building_sf).toLocaleString()} SF` : ""}
              {" · "}{asset.status === "sold" ? `Sold ${asset.sold_on ?? ""}` : asset.status === "under_contract" ? "Under contract" : "Owned"}
              {deal ? <> · closing deal <Link href={`/deals/${deal.id}/financials`}>{dealRef(deal.ref)}</Link></> : null}
            </p>
          </div>
        </div>

        <section className="panel">
          <h2>Underwritten vs actual</h2>
          {!deal && <p className="hint">No closing deal is linked to this asset, so there&apos;s no underwriting to compare. Actuals still come from the rent roll.</p>}
          <table className="summary-table">
            <thead>
              <tr><th></th><th>Underwritten</th><th>Actual</th><th>Difference</th></tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Purchase price</th>
                <td>{usd(latest?.returns_summary?.purchasePrice ?? null)}{perf.uw.allInCost ? <span className="muted"> · {usd(perf.uw.allInCost)} all-in</span> : null}</td>
                <td>{usd(perf.price)}{asset.acquisition_costs ? <span className="muted"> + {usd(asset.acquisition_costs)} costs</span> : null}</td>
                <td>{delta(perf.price, latest?.returns_summary?.purchasePrice ?? null, (v) => usd(v))}</td>
              </tr>
              <tr>
                <th scope="row">Annual rent</th>
                <td>{usd(perf.uw.rent)}{perf.uw.rent != null ? <span className="muted"> in place at UW</span> : null}</td>
                <td>{usd(perf.actual.rent)}{perf.actual.activeLeases ? <span className="muted"> · {perf.actual.activeLeases} lease{perf.actual.activeLeases === 1 ? "" : "s"}</span> : null}</td>
                <td>{delta(perf.actual.rent, perf.uw.rent, (v) => usd(v))}</td>
              </tr>
              <tr>
                <th scope="row">Yield on cost</th>
                <td>{pct(perf.uw.goingInYield)} <span className="muted">going-in</span>{perf.uw.stabilizedYield != null ? <span className="muted"> · {pct(perf.uw.stabilizedYield)} stabilized</span> : null}</td>
                <td>{pct(perf.actual.yieldOnCost)}</td>
                <td>{delta(perf.actual.yieldOnCost, perf.uw.goingInYield, (v) => `${(v * 10000).toFixed(0)} bp`)}</td>
              </tr>
              <tr>
                <th scope="row">Occupancy</th>
                <td>—</td>
                <td>{perf.actual.occupancy != null ? pct(perf.actual.occupancy, 0) : asset.occupancy ?? "—"}{perf.actual.occupancy != null ? <span className="muted"> of {ios ? "site acres" : "building SF"}</span> : null}</td>
                <td></td>
              </tr>
              <tr>
                <th scope="row">WALT</th>
                <td>—</td>
                <td>{yrs(perf.actual.walt)}</td>
                <td></td>
              </tr>
              <tr>
                <th scope="row">Hold</th>
                <td>{perf.uw.holdYears != null ? `${perf.uw.holdYears} yrs` : "—"}</td>
                <td>{yrs(perf.actual.heldYears)}{asset.purchased_on ? <span className="muted"> since {asset.purchased_on}</span> : null}</td>
                <td></td>
              </tr>
              <tr>
                <th scope="row">Exit cap</th>
                <td>{pct(perf.uw.exitCap)}</td>
                <td>—</td>
                <td></td>
              </tr>
              <tr>
                <th scope="row">Returns</th>
                <td>{pct(perf.uw.irr)} IRR · {x(perf.uw.multiple)}</td>
                <td>{perf.actual.realizedMultiple != null ? `${x(perf.actual.realizedMultiple)} on cost (sold)` : "Realized at sale"}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
          <p className="hint">
            Underwritten figures are the closing deal&apos;s latest model version and its in-place rent. Actual rent and yield come
            from the active leases below, against the purchase price plus acquisition costs.
          </p>
        </section>

        <LeasesPanel assetId={asset.id} leases={(leases ?? []) as Lease[]} today={today} ios={ios} address={asset.address} city={asset.city ?? null} />
      </main>
    </>
  );
}
