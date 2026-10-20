// app/deals/portfolios/[id]/page.tsx
//
// A portfolio package viewed as a whole: totals, the split by market, and
// every site with its stage, allocated price and basis, and what the comps
// near it support -- lease-up rent and today's value per acre. Each site
// stays its own deal; this page reads them together.

import { notFound } from "next/navigation";
import { getServiceClient } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Badge, STAGE_TONES } from "@/components/ui";
import { STAGE_LABELS } from "@/lib/deals";
import { dealRef } from "@/lib/format";
import { loadCompEvidence, subjectOf } from "@/lib/comps/evidence";
import { compUnderwriting, type UwComp } from "@/lib/comps/underwriting";
import AllocatedPriceInput from "@/components/AllocatedPriceInput";
import PortfolioActions from "@/components/PortfolioActions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AC = 43560;
const usd = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);
const usdM = (v: number | null | undefined) => (v == null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : usd(v));
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return { title: "Portfolio" };
  const { data } = await getServiceClient().from("deal_portfolios").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Portfolio" };
}

export default async function PortfolioPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return notFound();
  const db = getServiceClient();
  const [{ data: pf, error }, { data: deals, error: dealsError }, comps] = await Promise.all([
    db.from("deal_portfolios").select("*").eq("id", id).maybeSingle(),
    db.from("deals")
      .select("id, ref, stage, asset_class, asking_price, contract_price, closed_price, properties(address, city, market, submarket, latitude, longitude, lot_sf, building_sf, occupancy_status)")
      .eq("deal_portfolio_id", id)
      .order("created_at"),
    loadCompEvidence(),
  ]);
  if (error) throw new Error(`Loading portfolio: ${error.message}`);
  if (dealsError) throw new Error(`Loading portfolio sites: ${dealsError.message}`);
  if (!pf) return notFound();
  const omUrl = pf.om_path ? (await db.storage.from("documents").createSignedUrl(pf.om_path, 3600)).data?.signedUrl ?? null : null;

  const sites = (deals ?? []).map((d: any) => {
    const p = d.properties ?? {};
    const acres = num(p.lot_sf) ? num(p.lot_sf)! / AC : null;
    const sf = num(p.building_sf);
    const price = num(d.closed_price) ?? num(d.contract_price) ?? num(d.asking_price);
    const uw = compUnderwriting(comps as UwComp[], subjectOf(d));
    return { d, p, acres, sf, price, uw, ios: d.asset_class !== "industrial" };
  });
  type Site = (typeof sites)[number];

  // Comp-supported value today and market rent a year: per acre for IOS, per SF for industrial.
  const compValue = (s: Site) => {
    const rate = s.ios ? s.uw.sale.perAcre.mid : s.uw.sale.perSf.mid;
    const qty = s.ios ? s.acres : s.sf;
    return rate != null && qty ? rate * qty : null;
  };
  const compRent = (s: Site) =>
    s.ios ? (s.uw.lease.monthlyByAcre?.mid != null ? s.uw.lease.monthlyByAcre.mid * 12 : null) : s.uw.lease.annualBySf?.mid ?? null;
  const total = (ss: Site[], f: (s: Site) => number | null) => ss.reduce((t, s) => t + (f(s) ?? 0), 0);

  const totalPrice = total(sites, (s) => s.price);
  const totalAcres = total(sites, (s) => s.acres);
  const totalSf = total(sites, (s) => s.sf);
  const priced = sites.filter((s) => s.price != null).length;
  const valued = sites.filter((s) => compValue(s) != null);
  const rented = sites.filter((s) => compRent(s) != null);

  const byMarket = new Map<string, Site[]>();
  for (const s of sites) {
    const k = s.p.market || "No market";
    byMarket.set(k, [...(byMarket.get(k) ?? []), s]);
  }
  const markets = [...byMarket.entries()].sort((a, b) => b[1].length - a[1].length);
  const stages = new Map<string, number>();
  for (const s of sites) stages.set(s.d.stage, (stages.get(s.d.stage) ?? 0) + 1);

  return (
    <>
      <Nav active="deals" />
      <main className="wide">
        <div className="page-header">
          <div>
            <p className="crumbs"><a href="/deals">Deals</a> · Portfolio</p>
            <h1>{pf.name}</h1>
            <p className="hint" style={{ margin: 0 }}>
              {sites.length} sites in {markets.length} market{markets.length === 1 ? "" : "s"}
              {pf.seller_broker ? ` · ${pf.seller_broker}` : ""}
              {omUrl ? <> · <a href={omUrl} target="_blank" rel="noreferrer">Open the OM</a></> : null}
            </p>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[...stages.entries()].map(([st, n]) => (
              <Badge key={st} tone={STAGE_TONES[st] ?? "neutral"}>{n} {STAGE_LABELS[st] ?? st}</Badge>
            ))}
          </div>
        </div>

        <div className="kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginBottom: 20 }}>
          <Kpi label="Allocated price" value={usdM(totalPrice || null)} sub={`${priced} of ${sites.length} sites priced`} />
          <Kpi label="Land" value={totalAcres ? `${totalAcres.toFixed(1)} AC` : "—"} sub={totalPrice && totalAcres ? `${usd(totalPrice / totalAcres)}/AC` : undefined} />
          <Kpi label="Building" value={totalSf ? `${Math.round(totalSf).toLocaleString()} SF` : "—"} sub={totalPrice && totalSf ? `$${(totalPrice / totalSf).toFixed(0)}/SF` : undefined} />
          <Kpi label="Comp value today" value={usdM(valued.length ? total(valued, compValue) : null)} sub={`${valued.length} of ${sites.length} sites have enough sale comps`} />
          <Kpi label="Comp market rent" value={rented.length ? `${usdM(total(rented, compRent))}/yr` : "—"} sub={`${rented.length} of ${sites.length} sites have enough lease comps`} />
        </div>

        <section className="panel">
          <h2>By market</h2>
          <table className="summary-table">
            <thead>
              <tr><th>Market</th><th>Sites</th><th>Acres</th><th>Bldg SF</th><th>Allocated price</th><th>$/AC</th><th>Comp value today</th></tr>
            </thead>
            <tbody>
              {markets.map(([m, ss]) => {
                const price = total(ss, (s) => s.price);
                const ac = total(ss, (s) => s.acres);
                const sf = total(ss, (s) => s.sf);
                const cv = ss.filter((s) => compValue(s) != null);
                return (
                  <tr key={m}>
                    <td>{m}</td>
                    <td>{ss.length}</td>
                    <td>{ac ? ac.toFixed(1) : "—"}</td>
                    <td>{sf ? Math.round(sf).toLocaleString() : "—"}</td>
                    <td>{usdM(price || null)}</td>
                    <td>{price && ac ? usd(price / ac) : "—"}</td>
                    <td>{cv.length ? `${usdM(total(cv, compValue))}${cv.length < ss.length ? ` (${cv.length} of ${ss.length} sites)` : ""}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Sites</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="summary-table">
              <thead>
                <tr><th>Site</th><th>Market</th><th>Stage</th><th>Acres</th><th>Bldg SF</th><th>Allocated price</th><th>$/AC</th><th>Comp rent $/AC/mo</th><th>Comp value $/AC</th><th>Price vs comps</th></tr>
              </thead>
              <tbody>
                {sites.map((s) => {
                  const cv = compValue(s);
                  const gap = s.price && cv ? s.price / cv - 1 : null;
                  return (
                    <tr key={s.d.id}>
                      <td>
                        <a href={`/deals/${s.d.id}/financials`}>{s.p.address ?? "Untitled"}</a> <span className="muted">{dealRef(s.d.ref)}</span>
                        <br />
                        <span className="muted">{[s.p.city, s.ios ? "IOS" : "Industrial"].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td>{s.p.market ?? "—"}</td>
                      <td><Badge tone={STAGE_TONES[s.d.stage] ?? "neutral"}>{STAGE_LABELS[s.d.stage] ?? s.d.stage}</Badge></td>
                      <td>{s.acres ? s.acres.toFixed(2) : "—"}</td>
                      <td>{s.sf ? Math.round(s.sf).toLocaleString() : "—"}</td>
                      <td>
                        <AllocatedPriceInput dealId={s.d.id} price={num(s.d.asking_price)} />
                        {s.price !== num(s.d.asking_price) && s.price != null && (
                          <><br /><span className="muted">{num(s.d.closed_price) != null ? "Closed" : "Contract"} {usdM(s.price)}</span></>
                        )}
                      </td>
                      <td>{s.price && s.acres ? usd(s.price / s.acres) : "—"}</td>
                      <td title={s.uw.lease.perAcreMonthly.source}>{usd(s.uw.lease.perAcreMonthly.mid)}</td>
                      <td title={s.uw.sale.perAcre.source}>{usd(s.uw.sale.perAcre.mid)}</td>
                      <td>
                        {gap == null ? "—" : <span className={gap > 0.1 ? "overdue" : undefined}>{gap >= 0 ? "+" : ""}{(gap * 100).toFixed(0)}%</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">
            Comp figures match each site&apos;s Financials tab: comps within 10 mi from the last 24 months, widening to 25 mi and
            then the site&apos;s market. Hover a figure for its basis. &ldquo;Price vs comps&rdquo; is the price against the comp
            value today (per acre for IOS, per SF for industrial); above +10% is highlighted.
          </p>
          {pf.notes?.length > 0 && (
            <details>
              <summary>Notes from reading the OM ({pf.notes.length})</summary>
              <ul>{pf.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul>
            </details>
          )}
        </section>

        <PortfolioActions
          portfolioId={pf.id}
          active={sites.filter((s) => s.d.stage !== "archived" && s.d.stage !== "closed").length}
          archived={sites.filter((s) => s.d.stage === "archived").length}
          closed={sites.filter((s) => s.d.stage === "closed").length}
        />
      </main>
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel" style={{ margin: 0 }}>
      <span className="label">{label}</span>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
      {sub && <span className="hint" style={{ margin: 0 }}>{sub}</span>}
    </div>
  );
}
