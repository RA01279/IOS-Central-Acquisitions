"use client";

import { useState } from "react";
import {
  fetchDemandMap,
  computePixelPositions,
  densityByBand,
  halfExtentMiles,
  ringMiles,
  exportToPptx,
  DEFAULT_CATEGORIES,
  type DemandMapResponse,
  type MapType,
} from "@/lib/ic-deck/iosDemandMap";

export default function IcDeckPanel({
  dealId,
  addressForSubtitle,
  fileNameStem,
}: {
  dealId: string;
  addressForSubtitle?: string | null;
  fileNameStem?: string | null;
}) {
  const [radiusMiles, setRadiusMiles] = useState(5);
  const [maptype, setMaptype] = useState<MapType>("satellite");
  const [data, setData] = useState<DemandMapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDemandMap(dealId, {
        radiusMiles,
        maptype,
        categories: DEFAULT_CATEGORIES,
      });
      setData(result);
    } catch (e: any) {
      setError(e.message || "Failed to generate demand map");
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    if (!data) return;
    setExporting(true);
    setError(null);
    try {
      await exportToPptx(
        data,
        {
          subtitle: addressForSubtitle
            ? `${addressForSubtitle}  |  Potential IOS users within a ${data.radiusMiles}-mile radius`
            : undefined,
          fileName: fileNameStem ? `${fileNameStem}_IOS_Demand_Map` : undefined,
        },
        DEFAULT_CATEGORIES
      );
    } catch (e: any) {
      setError(e.message || "Failed to export deck");
    } finally {
      setExporting(false);
    }
  }

  const preview = data ? computePixelPositions(data) : null;
  // Same rings and density bands the deck draws, so the preview is a true
  // proof of what will export rather than an approximation of it.
  const halfExtent = data ? halfExtentMiles(data) : 0;
  const rings = data ? ringMiles(data.radiusMiles, halfExtent) : [];
  const bands = data ? densityByBand(data.tenants, rings) : [];

  return (
    <section className="panel">
      <h2>IC Deck — IOS Demand Map</h2>
      <p className="muted">
        Nearby tenants by IOS use category (auto storage, building materials, chemical/waste,
        container storage, contractor yards, equipment rental &amp; sales), pulled live from
        Google Places, on a true-colour satellite basemap.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 0", flexWrap: "wrap" }}>
        <label className="label" htmlFor="radius-select" style={{ margin: 0 }}>
          Radius
        </label>
        <select
          id="radius-select"
          value={radiusMiles}
          onChange={(e) => setRadiusMiles(Number(e.target.value))}
          disabled={loading}
        >
          {[3, 5, 7].map((mi) => (
            <option key={mi} value={mi}>
              {mi} mi
            </option>
          ))}
        </select>

        <label className="label" htmlFor="maptype-select" style={{ margin: 0 }}>
          Basemap
        </label>
        <select
          id="maptype-select"
          value={maptype}
          onChange={(e) => setMaptype(e.target.value as MapType)}
          disabled={loading}
        >
          <option value="satellite">Satellite</option>
          <option value="hybrid">Satellite + labels</option>
        </select>

        <button onClick={handleGenerate} disabled={loading}>
          {loading ? "Generating…" : data ? "Regenerate" : "Generate Demand Map"}
        </button>
        {data && (
          <button onClick={handleExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export IC Deck (.pptx)"}
          </button>
        )}
      </div>

      {error && <p className="warning">{error}</p>}

      {data && preview && (
        <>
          <div style={{ position: "relative", width: "100%", maxWidth: 640, marginTop: 8 }}>
            <img
              src={data.imageBase64}
              alt={`Satellite basemap centred on ${data.address}`}
              style={{ width: "100%", display: "block", borderRadius: 6 }}
            />
            {/* viewBox tracks the raster the API actually returned -- it used to
                be hardcoded to a 2560x2048 image that the Static Maps size cap
                meant was never produced. */}
            <svg
              viewBox={`0 0 ${preview.size} ${preview.size}`}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
            >
              {rings.map((mi) => {
                // Half the image's pixel side length is exactly halfExtent miles.
                const rPx = (mi / halfExtent) * (preview.size / 2);
                return (
                  <g key={mi}>
                    <circle
                      cx={preview.size / 2}
                      cy={preview.size / 2}
                      r={rPx}
                      fill="none"
                      stroke="white"
                      strokeWidth={3}
                      strokeDasharray="14 10"
                      opacity={0.85}
                    />
                    <text
                      x={preview.size / 2}
                      y={preview.size / 2 - rPx}
                      fontSize={26}
                      fill="white"
                      stroke="black"
                      strokeWidth={4}
                      paintOrder="stroke"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontWeight="bold"
                    >
                      {mi} mi
                    </text>
                  </g>
                );
              })}
              {preview.tenants.map((t, i) => {
                const color =
                  DEFAULT_CATEGORIES.find((c) => c.label === t.category)?.color || "999999";
                return (
                  <g key={t.placeId}>
                    <circle cx={t.px.x} cy={t.px.y} r={20} fill="rgba(0,0,0,0.45)" />
                    <circle cx={t.px.x} cy={t.px.y} r={18} fill={`#${color}`} stroke="white" strokeWidth={3} />
                    <text
                      x={t.px.x}
                      y={t.px.y}
                      fontSize={17}
                      fill="white"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontWeight="bold"
                    >
                      {i + 1}
                    </text>
                  </g>
                );
              })}
              <circle cx={preview.site.x} cy={preview.site.y} r={30} fill="rgba(0,0,0,0.45)" />
              <circle cx={preview.site.x} cy={preview.site.y} r={22} fill="#FF5A4E" stroke="white" strokeWidth={4} />
            </svg>
          </div>

          <p className="hint" style={{ marginTop: 8 }}>
            {data.tenants.length} tenants within {data.radiusMiles} mi of {data.address}
            {bands.length > 0 && (
              <> · {bands.map((b) => `${b.count} within ${b.mi} mi`).join(" · ")}</>
            )}
          </p>

          <div className="dash-cols" style={{ marginTop: 8 }}>
            {DEFAULT_CATEGORIES.map((cat) => {
              const items = data.tenants
                .map((t, i) => ({ ...t, num: i + 1 }))
                .filter((t) => t.category === cat.label)
                .sort((a, b) => a.distanceMi - b.distanceMi);
              if (!items.length) return null;
              return (
                <div key={cat.label}>
                  <div
                    style={{
                      background: `#${cat.color}`,
                      color: "white",
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: 0.3,
                      padding: "3px 8px",
                      borderRadius: 4,
                      marginBottom: 4,
                    }}
                  >
                    {cat.label.toUpperCase()} ({items.length})
                  </div>
                  <ul className="doc-list" style={{ gap: 2, fontSize: 13 }}>
                    {items.map((t) => (
                      <li key={t.placeId}>
                        <strong style={{ color: `#${cat.color}` }}>{t.num}</strong> {t.name}
                        <span className="muted"> · {t.distanceMi.toFixed(1)} mi</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
