"use client";
// components/PipelineMap.tsx
//
// The pipeline on a map, coloured by stage. Archived deals are excluded (they
// aren't pipeline), which the server query already handles; everything else --
// Prospect through Closed -- is here, with each stage toggleable so a dense
// market can be read one stage at a time.

import { useMemo, useState } from "react";
import MapView, { type MapPoint } from "./MapView";

export interface PipelineMapDeal {
  id: string;
  stage: string;
  asset_class: string | null;
  address: string | null;
  city: string | null;
  market: string | null;
  latitude: number | null;
  longitude: number | null;
  lot_sf: number | null;
  building_sf: number | null;
  dd_end_on: string | null;
  closing_on: string | null;
  closed_on: string | null;
  last_offer_price: number | null;
}

const SQFT_PER_ACRE = 43560;

export default function PipelineMap({
  deals,
  stages,
  stageLabels,
  stageColors,
  assetClassLabels,
}: {
  deals: PipelineMapDeal[];
  stages: string[];
  stageLabels: Record<string, string>;
  stageColors: Record<string, string>;
  assetClassLabels: Record<string, string>;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [assetClass, setAssetClass] = useState<string>("__all");

  const mappable = useMemo(
    () => deals.filter((d) => d.latitude != null && d.longitude != null),
    [deals]
  );
  const unmappable = deals.length - mappable.length;

  const visible = useMemo(
    () =>
      mappable.filter(
        (d) =>
          !hidden.has(d.stage) && (assetClass === "__all" || d.asset_class === assetClass)
      ),
    [mappable, hidden, assetClass]
  );

  const points: MapPoint[] = useMemo(
    () =>
      visible.map((d) => {
        const acres = d.lot_sf ? (d.lot_sf / SQFT_PER_ACRE).toFixed(2) : null;
        return {
          id: d.id,
          lat: Number(d.latitude),
          lng: Number(d.longitude),
          color: stageColors[d.stage] ?? "7F8C8D",
          title: d.address ?? "Untitled deal",
          href: `/deals/${d.id}`,
          lines: [
            [
              stageLabels[d.stage] ?? d.stage,
              d.asset_class ? assetClassLabels[d.asset_class] : null,
            ]
              .filter(Boolean)
              .join(" · "),
            [
              acres ? `${acres} ac` : null,
              d.building_sf ? `${Math.round(d.building_sf).toLocaleString()} SF` : null,
              d.last_offer_price ? `$${Math.round(d.last_offer_price).toLocaleString()}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
            // The dates that matter when a deal is under contract.
            [
              d.dd_end_on ? `DD to ${d.dd_end_on}` : null,
              d.closed_on ? `closed ${d.closed_on}` : d.closing_on ? `closes ${d.closing_on}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
            [d.city, d.market].filter(Boolean).join(", "),
          ].filter((l) => l.length > 0),
        };
      }),
    [visible, stageColors, stageLabels, assetClassLabels]
  );

  const countFor = (stage: string) =>
    mappable.filter(
      (d) => d.stage === stage && (assetClass === "__all" || d.asset_class === assetClass)
    ).length;

  const assetClasses = useMemo(
    () => Array.from(new Set(deals.map((d) => d.asset_class).filter(Boolean) as string[])).sort(),
    [deals]
  );

  return (
    <section className="panel">
      <h2>
        Pipeline map <span className="count">{visible.length}</span>
      </h2>

      {assetClasses.length > 1 && (
        <div className="filter-chips">
          <button
            type="button"
            className={assetClass === "__all" ? "chip chip-active" : "chip"}
            onClick={() => setAssetClass("__all")}
          >
            All
          </button>
          {assetClasses.map((ac) => (
            <button
              key={ac}
              type="button"
              className={assetClass === ac ? "chip chip-active" : "chip"}
              onClick={() => setAssetClass(ac)}
            >
              {assetClassLabels[ac] ?? ac}
            </button>
          ))}
        </div>
      )}

      {/* Stage toggles double as the legend, so the colours are never explained
          somewhere other than where they're controlled. */}
      <div className="filter-chips">
        {stages.map((stage) => {
          const off = hidden.has(stage);
          return (
            <button
              key={stage}
              type="button"
              className={off ? "chip" : "chip chip-active"}
              onClick={() =>
                setHidden((prev) => {
                  const next = new Set(prev);
                  if (next.has(stage)) next.delete(stage);
                  else next.add(stage);
                  return next;
                })
              }
              title={off ? `Show ${stageLabels[stage] ?? stage}` : `Hide ${stageLabels[stage] ?? stage}`}
            >
              <span
                className="map-legend-dot"
                style={{
                  background: `#${stageColors[stage] ?? "7F8C8D"}`,
                  opacity: off ? 0.3 : 1,
                }}
              />
              {stageLabels[stage] ?? stage} <span className="muted">{countFor(stage)}</span>
            </button>
          );
        })}
      </div>

      <MapView
        points={points}
        height={520}
        emptyMessage={
          deals.length === 0
            ? "No deals in the pipeline."
            : "No deals match this filter — check the stage toggles above."
        }
      />

      <p className="hint" style={{ marginTop: 10 }}>
        Hover a pin for the details, click it to open the deal. Scroll to zoom, drag to pan.
        {unmappable > 0 && (
          <>
            {" "}
            <span className="overdue">
              {unmappable} deal{unmappable === 1 ? "" : "s"} not on the map
            </span>{" "}
            — the address is a portfolio placeholder or too vague to geocode.
          </>
        )}
      </p>
    </section>
  );
}
