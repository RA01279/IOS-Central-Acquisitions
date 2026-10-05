// /map -- every active deal on one map, coloured by site score (or by stage
// with ?by=stage). Replaces the pipeline map that used to sit above the board.

import { getServiceClient } from "@/lib/supabase";
import { ASSET_CLASSES, ASSET_CLASS_LABELS, STAGE_COLORS, STAGE_LABELS, ACQUISITION_STAGES } from "@/lib/deals";
import { DEAL_CARD_SELECT, toDealCard } from "@/lib/deal-view";
import { loadSignals } from "@/lib/site-signals";
import { scoreState, signal } from "@/lib/hopper-tokens";
import { locationReady } from "@/lib/location";
import Nav from "@/components/Nav";
import MapView, { type MapPoint } from "@/components/MapView";
import { DarkKpi } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio Map" };

const UNSCORED = "9AA8B5";

export default async function PortfolioMapPage(props: { searchParams: Promise<{ by?: string; asset?: string }> }) {
  const sp = await props.searchParams;
  const by = sp.by === "stage" ? "stage" : "score";
  const asset = (ASSET_CLASSES as readonly string[]).includes(sp.asset ?? "") ? sp.asset! : "all";

  let q = getServiceClient()
    .from("deals")
    .select(DEAL_CARD_SELECT)
    .eq("deal_type", "acquisition")
    .not("stage", "in", "(archived,closed)");
  if (asset !== "all") q = q.eq("asset_class", asset);
  const { data: rows } = await q;
  const signals = await loadSignals((rows ?? []).map((d: any) => d.id));
  const cards = (rows ?? []).map((d: any) => toDealCard(d, signals.get(d.id)));
  const mappable = cards.filter((c) => locationReady({ latitude: c.lat, longitude: c.lng, geocode_precision: c.geocodePrecision }));

  const colorOf = (c: (typeof cards)[number]) =>
    by === "stage" ? STAGE_COLORS[c.stage] ?? UNSCORED : c.score == null ? UNSCORED : signal[scoreState(c.score)].fg;

  const points: MapPoint[] = mappable.map((c) => ({
    id: c.id,
    lat: c.lat!,
    lng: c.lng!,
    color: colorOf(c),
    title: c.name,
    href: `/deals/${c.id}`,
    lines: [
      [c.stageLabel, c.typeLabel, c.sizeLabel].filter(Boolean).join(" · "),
      `Score ${c.score ?? "—"} · ${c.priceLabel}`,
    ],
  }));

  const legend =
    by === "stage"
      ? ACQUISITION_STAGES.filter((s) => s !== "closed").map((s) => ({
          label: STAGE_LABELS[s],
          color: STAGE_COLORS[s],
          count: mappable.filter((c) => c.stage === s).length,
        }))
      : (["strong", "watch", "weak"] as const)
          .map((s) => ({
            label: `${signal[s].label} (${s === "strong" ? "75+" : s === "watch" ? "55–74" : "<55"})`,
            color: signal[s].fg,
            count: mappable.filter((c) => c.score != null && scoreState(c.score) === s).length,
          }))
          .concat([{ label: "Not scored", color: UNSCORED, count: mappable.filter((c) => c.score == null).length }]);

  const link = (patch: Record<string, string>) => {
    const params = new URLSearchParams({ ...(by !== "score" ? { by } : {}), ...(asset !== "all" ? { asset } : {}), ...patch });
    for (const [k, v] of [...params]) if ((k === "by" && v === "score") || (k === "asset" && v === "all")) params.delete(k);
    const s = params.toString();
    return `/map${s ? `?${s}` : ""}`;
  };
  const chip = (on: boolean) =>
    on ? { background: "#fff", color: "#0A2540", borderColor: "#fff" } : { background: "transparent", color: "#A9D0EC", borderColor: "rgba(255,255,255,.2)" };

  return (
    <>
      <Nav active="map" />
      <main className="bleed">
        <div className="ph">
          <div className="ph-row">
            <div className="ph-title">
              <span className="eyebrow">Active pipeline</span>
              <h1>Portfolio Map</h1>
            </div>
            <div className="ph-actions">
              <a href={link({ by: "score" })} className="tchip" style={chip(by === "score")}>By site score</a>
              <a href={link({ by: "stage" })} className="tchip" style={chip(by === "stage")}>By stage</a>
              <span className="tdiv" style={{ background: "rgba(255,255,255,.2)" }} />
              {[...ASSET_CLASSES, "all"].map((a) => (
                <a key={a} href={link({ asset: a })} className="tchip" style={chip(asset === a)}>
                  {a === "all" ? "All" : ASSET_CLASS_LABELS[a]}
                </a>
              ))}
            </div>
          </div>
          <div className="ph-kpis">
            <DarkKpi label="Active deals" value={cards.length} />
            <DarkKpi label="On the map" value={mappable.length} sub={cards.length - mappable.length ? `${cards.length - mappable.length} need a pin` : undefined} />
            <DarkKpi label="Strong sites" value={cards.filter((c) => c.score != null && c.score >= 75).length} />
            <DarkKpi label="Not scored" value={cards.filter((c) => c.score == null).length} />
          </div>
        </div>
        <div className="ws-body">
          <MapView points={points} legend={legend} height={620} emptyMessage="No active deals have a verified location yet." />
          {cards.length > mappable.length && (
            <p className="hint">
              Not on the map (no verified pin):{" "}
              {cards
                .filter((c) => !mappable.includes(c))
                .map((c, i) => (
                  <span key={c.id}>
                    {i ? ", " : ""}
                    <a href={`/deals/${c.id}/demand-map`}>{c.name}</a>
                  </span>
                ))}
            </p>
          )}
        </div>
      </main>
    </>
  );
}
