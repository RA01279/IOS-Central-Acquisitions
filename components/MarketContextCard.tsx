// components/MarketContextCard.tsx
//
// Summary-tab card: the market narrative for the deal's submarket (matched on
// the property's submarket or city), else for its market, from the broker
// reports on file. Links to the Market page for the full read and sources.

export type ContextNarrative = { market: string; submarket: string | null; headline: string; narrative: string; generated_at: string; sources: { publisher: string; period: string | null }[] };

export default function MarketContextCard({ narrative, market }: { narrative: ContextNarrative | null; market: string | null }) {
  if (!narrative) {
    return market ? (
      <div className="card" style={{ gap: 6 }}>
        <div className="card-head"><span className="overline">Market context</span><a href={`/market?market=${encodeURIComponent(market)}#market-reports`} className="link-caps">Market page</a></div>
        <p className="hint" style={{ margin: 0 }}>No market narrative for {market} yet. Upload a broker market report on the Market page.</p>
      </div>
    ) : null;
  }
  const first = narrative.narrative.split(/\n{2,}/)[0];
  const area = narrative.submarket ? `${narrative.submarket} (${narrative.market})` : narrative.market;
  return (
    <div className="card" style={{ gap: 6 }}>
      <div className="card-head">
        <span className="overline">Market context · {area}</span>
        <a href={`/market?market=${encodeURIComponent(narrative.market)}#market-reports`} className="link-caps">Full read</a>
      </div>
      <strong style={{ fontSize: 13 }}>{narrative.headline}</strong>
      <p style={{ margin: 0, fontSize: 13 }}>{first}</p>
      <p className="hint" style={{ margin: 0 }}>
        From {narrative.sources.map((s) => `${s.publisher}${s.period ? ` ${s.period}` : ""}`).join(", ") || "broker reports"} and Hopper comps · {new Date(narrative.generated_at).toLocaleDateString("en-US")}
      </p>
    </div>
  );
}
