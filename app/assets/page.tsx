// app/assets/page.tsx
//
// The portfolio: everything we own, on a map and in a table.
//
// Separate from the pipeline on purpose. /deals is what we're looking at;
// this is what we hold. The two only meet on a deal page, where a prospect is
// measured against the assets around it.
import Nav from "@/components/Nav";
import AssetsView, { type AssetDetail } from "@/components/AssetsView";
import { getServiceClient } from "@/lib/supabase";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("assets")
    .select("*")
    .order("market", { ascending: true, nullsFirst: false })
    .order("address", { ascending: true })
    .limit(2000);

  const assets = (data ?? []) as AssetDetail[];
  const owned = assets.filter((a) => a.status !== "sold");
  const withSpace = owned.filter((a) => a.occupancy === "available");
  // Acreage is the number a portfolio is actually discussed in, and it's the
  // one the source page doesn't publish -- so say how much is still missing
  // rather than showing a total that quietly understates itself.
  const missingAcres = owned.filter((a) => a.site_acres == null).length;
  const totalAcres = owned.reduce((s, a) => s + (a.site_acres ? Number(a.site_acres) : 0), 0);

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

        <div className="stat-grid stat-grid-3">
          <div className="stat-tile">
            <span className="stat-value">{owned.length}</span>
            <span className="stat-label">Assets owned</span>
            {assets.length > owned.length && (
              <span className="stat-delta">
                + {assets.length - owned.length} sold, kept for history
              </span>
            )}
          </div>
          <div className="stat-tile">
            <span className="stat-value">{withSpace.length}</span>
            <span className="stat-label">With space available</span>
          </div>
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

        <AssetsView assets={assets} />
      </main>
    </>
  );
}
