// app/assets/page.tsx
//
// The portfolio: everything we own, on a map and in a table.
//
// Separate from the pipeline on purpose. /deals is what we're looking at;
// this is what we hold. The two only meet on a deal page, where a prospect is
// measured against the assets around it.
import Nav from "@/components/Nav";
import Link from "next/link";
import AssetsView, { type AssetDetail, type OccupancyFilter } from "@/components/AssetsView";
import { getServiceClient } from "@/lib/supabase";
import { BarRows, Legend, SERIES, SERIES_SOFT } from "@/components/charts";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

export default async function AssetsPage(props: { searchParams: Promise<{ occ?: string }> }) {
  const sp = await props.searchParams;
  // The tiles link here with ?occ=space / ?occ=occupied to open the table filtered.
  const occ: OccupancyFilter = sp.occ === "space" || sp.occ === "occupied" ? sp.occ : "all";
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("assets")
    .select("*")
    .neq("status", "under_contract")
    .order("market", { ascending: true, nullsFirst: false })
    .order("address", { ascending: true })
    .limit(2000);

  const assets = (data ?? []) as AssetDetail[];
  const owned = assets.filter((a) => a.status !== "sold");
  const withSpace = owned.filter((a) => a.occupancy === "available" || a.occupancy === "partial");
  // Acreage is the number a portfolio is actually discussed in, and it's the
  // one the source page doesn't publish -- so say how much is still missing
  // rather than showing a total that quietly understates itself.
  const missingAcres = owned.filter((a) => a.site_acres == null).length;
  const totalAcres = owned.reduce((s, a) => s + (a.site_acres ? Number(a.site_acres) : 0), 0);
  // Owned assets per market: how many, how many have space, and the acres on record.
  const byMarket = [...new Set(owned.map((a) => a.market?.trim() || "No market"))]
    .map((name) => {
      const list = owned.filter((a) => (a.market?.trim() || "No market") === name);
      return {
        name,
        count: list.length,
        available: list.filter((a) => a.occupancy === "available" || a.occupancy === "partial").length,
        acres: list.reduce((s, a) => s + (a.site_acres ? Number(a.site_acres) : 0), 0),
        missing: list.filter((a) => a.site_acres == null).length,
      };
    })
    .sort((a, b) => b.count - a.count);
  // An acreage chart only means something once most assets have acres entered.
  const showAcres = owned.length > 0 && missingAcres <= owned.length / 2;

  return (
    <>
      <Nav active="assets" />
      <main className="wide">
        <div className="page-header">
          <div>
            <h1>Our assets</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              The IOS portfolio. On a deal, these are measured against the prospect.
            </p>
          </div>
        </div>

        <div className="stat-grid">
          <Link href="/assets#assets-table" className={occ === "all" ? "stat-tile stat-on" : "stat-tile"}>
            <span className="stat-value">{owned.length}</span>
            <span className="stat-label">Assets owned</span>
            {assets.length > owned.length && (
              <span className="stat-delta">
                + {assets.length - owned.length} sold, kept for history
              </span>
            )}
          </Link>
          <Link href="/assets?occ=space#assets-table" className={occ === "space" ? "stat-tile stat-on" : "stat-tile"}>
            <span className="stat-value">{withSpace.length}</span>
            <span className="stat-label">With space available</span>
            <span className="stat-delta">
              {withSpace.filter((a) => a.occupancy === "partial").length
                ? `${withSpace.filter((a) => a.occupancy === "partial").length} partly leased · `
                : ""}
              Click to see and update
            </span>
          </Link>
          <Link href="/assets?occ=occupied#assets-table" className={occ === "occupied" ? "stat-tile stat-on" : "stat-tile"}>
            <span className="stat-value">{owned.length - withSpace.length}</span>
            <span className="stat-label">Fully occupied</span>
            <span className="stat-delta">Tenant left? Mark it here</span>
          </Link>
          <div className="stat-tile">
            <span className={missingAcres ? "stat-value stat-bad" : "stat-value"}>
              {totalAcres ? Math.round(totalAcres).toLocaleString() : "—"}
            </span>
            <span className="stat-label">Acres recorded</span>
            {missingAcres > 0 && (
              <span className="stat-delta stat-delta-bad">
                {missingAcres} asset{missingAcres === 1 ? "" : "s"} with no acreage yet
              </span>
            )}
          </div>
        </div>

        {missingAcres > 0 && (
          <div className="warning">
            <strong>
              {missingAcres} of {owned.length} assets have no site acreage recorded.
            </strong>{" "}
            The portfolio was seeded from dalfen.com/ios, which publishes addresses and occupancy
            but not acreage or building size — so every acre total on this page understates the
            portfolio until they&apos;re entered. Use Edit on a row to add them.
          </div>
        )}

        {byMarket.length > 0 ? (
          <div className={showAcres ? "two-col" : undefined}>
            <section className="panel">
              <h2>Assets by market</h2>
              <Legend items={[{ label: "Leased / in use", color: SERIES[0] }, { label: "Space available", color: SERIES_SOFT }]} />
              <BarRows
                labelWidth={120}
                rows={byMarket.map((m) => ({
                  key: m.name,
                  label: m.name,
                  title: `${m.name}: ${m.count} owned, ${m.available} with space available`,
                  segments: [
                    { value: m.count - m.available, color: SERIES[0], title: `${m.count - m.available} leased / in use` },
                    { value: m.available, color: SERIES_SOFT, title: `${m.available} with space available` },
                  ],
                  value: <>{m.count}{m.available ? <span className="muted"> · {m.available} open</span> : null}</>,
                }))}
              />
            </section>
            {showAcres ? <section className="panel">
              <h2>Acres by market</h2>
              <BarRows
                labelWidth={120}
                rows={[...byMarket].sort((a, b) => b.acres - a.acres).map((m) => ({
                  key: m.name,
                  label: m.name,
                  title: m.missing ? `${m.missing} asset${m.missing === 1 ? "" : "s"} here with no acreage yet` : undefined,
                  segments: [{ value: m.acres, color: SERIES[0] }],
                  value: <>{m.acres ? `${Math.round(m.acres).toLocaleString()} ac` : "—"}{m.missing ? <span className="muted"> · {m.missing} unknown</span> : null}</>,
                }))}
              />
            </section> : null}
          </div>
        ) : null}

        <AssetsView key={occ} assets={assets} initialOccupancy={occ} />
      </main>
    </>
  );
}
