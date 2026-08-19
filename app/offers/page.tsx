import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import { ASSET_CLASSES, ASSET_CLASS_LABELS, STAGE_LABELS } from "@/lib/deals";
import { ctToday, isRangeKey, RANGE_KEYS, RANGE_LABELS, rangeStart } from "@/lib/summary";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

// The offer log maintains itself. Every offer reaches this page one of two
// ways, and neither is "someone remembers to update a spreadsheet":
//   * manual -- the Log offer button on a deal
//   * loi    -- recorded automatically when an LOI is generated at a price
// See recordOffer() in lib/deals.ts.

function fmtUsd(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `$${Math.round(v).toLocaleString()}`;
}

export default async function OffersPage({
  searchParams,
}: {
  searchParams: { asset?: string; range?: string };
}) {
  const assetParam = searchParams.asset;
  const asset =
    assetParam && (ASSET_CLASSES as readonly string[]).includes(assetParam) ? assetParam : "all";
  const range = isRangeKey(searchParams.range) ? searchParams.range : "ytd";
  const today = ctToday();
  const start = rangeStart(range, today);

  const supabase = getServiceClient();
  const { data } = await supabase
    .from("offers")
    .select(
      "id, price, offered_at, notes, source, created_by, created_at, deals(id, deal_type, stage, asset_class, properties(address, city, market, lot_sf))"
    )
    .gte("offered_at", start)
    .order("offered_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const rows = (data ?? []).filter((o: any) => {
    if (!o.deals || o.deals.deal_type === "lease") return false;
    if (asset !== "all" && o.deals.asset_class !== asset) return false;
    return true;
  });

  const subtotal = (ac: string) => {
    const list = rows.filter((o: any) => o.deals.asset_class === ac);
    return {
      count: list.length,
      value: list.reduce((sum: number, o: any) => sum + (o.price ?? 0), 0),
    };
  };
  const totals = {
    count: rows.length,
    value: rows.reduce((sum: number, o: any) => sum + (o.price ?? 0), 0),
  };
  const dealCount = new Set(rows.map((o: any) => o.deals.id)).size;

  const csvHref = `/api/offers/csv?range=${range}${asset !== "all" ? `&asset=${asset}` : ""}`;

  return (
    <>
      <Nav active="offers" />
      <AutoRefresh />
      <main className="wide">
        <div className="page-header">
          <div>
            <h1>Offer log</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              Every offer submitted, logged automatically when an LOI is generated. {start} to{" "}
              {today}.
            </p>
          </div>
          <div className="header-actions">
            <a href={csvHref} className="button-link">
              Download CSV
            </a>
          </div>
        </div>

        <div className="filter-chips">
          {RANGE_KEYS.map((k) => (
            <Link
              key={k}
              href={`/offers?range=${k}${asset !== "all" ? `&asset=${asset}` : ""}`}
              className={k === range ? "chip chip-active" : "chip"}
            >
              {RANGE_LABELS[k]}
            </Link>
          ))}
        </div>
        <div className="filter-chips">
          <Link
            href={`/offers?range=${range}`}
            className={asset === "all" ? "chip chip-active" : "chip"}
          >
            All asset classes
          </Link>
          {ASSET_CLASSES.map((c) => (
            <Link
              key={c}
              href={`/offers?range=${range}&asset=${c}`}
              className={asset === c ? "chip chip-active" : "chip"}
            >
              {ASSET_CLASS_LABELS[c]}
            </Link>
          ))}
        </div>

        <div className="stat-grid stat-grid-3">
          <div className="stat-tile">
            <span className="stat-value">{totals.count}</span>
            <span className="stat-label">Offers submitted</span>
            <span className="stat-delta">across {dealCount} deals</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{fmtUsd(totals.value)}</span>
            <span className="stat-label">Total offered</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">
              {totals.count ? fmtUsd(Math.round(totals.value / totals.count)) : "—"}
            </span>
            <span className="stat-label">Average offer</span>
          </div>
        </div>

        <section className="panel">
          <h2>
            Subtotals by asset class <span className="count">{totals.count}</span>
          </h2>
          <table className="summary-table">
            <thead>
              <tr>
                <th />
                <th>Offers</th>
                <th>Total offered</th>
              </tr>
            </thead>
            <tbody>
              {ASSET_CLASSES.map((ac) => {
                const st = subtotal(ac);
                return (
                  <tr key={ac}>
                    <th scope="row">{ASSET_CLASS_LABELS[ac]}</th>
                    <td>{st.count}</td>
                    <td>{fmtUsd(st.value)}</td>
                  </tr>
                );
              })}
              <tr className="summary-total">
                <th scope="row">Total</th>
                <td>{totals.count}</td>
                <td>{fmtUsd(totals.value)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>All offers</h2>
          {rows.length === 0 ? (
            <p className="muted">
              No offers dated inside this window. Log one from a deal, or generate an LOI — that
              records the offer for you.
            </p>
          ) : (
            <div className="table-scroll">
            <table className="summary-table log-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Property</th>
                  <th>Market</th>
                  <th>Class</th>
                  <th>Price</th>
                  <th>$/SF land</th>
                  <th>Stage</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o: any) => {
                  const lotSf = o.deals.properties?.lot_sf;
                  const psf = o.price && lotSf ? o.price / lotSf : null;
                  return (
                    <tr key={o.id}>
                      <td>{o.offered_at ?? "—"}</td>
                      <td>
                        <Link href={`/deals/${o.deals.id}`}>
                          {o.deals.properties?.address ?? "Untitled deal"}
                        </Link>
                      </td>
                      <td>{o.deals.properties?.market ?? "—"}</td>
                      <td>{ASSET_CLASS_LABELS[o.deals.asset_class] ?? "—"}</td>
                      <td>{fmtUsd(o.price)}</td>
                      <td>{psf === null ? "—" : `$${psf.toFixed(2)}`}</td>
                      <td>{STAGE_LABELS[o.deals.stage] ?? o.deals.stage}</td>
                      <td>
                        <span className="doc-type">{o.source === "loi" ? "LOI" : "MANUAL"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
