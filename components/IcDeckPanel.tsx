"use client";

import { useState } from "react";
import {
  fetchDemandMap,
  computePixelPositions,
  exportToPptx,
  DEFAULT_CATEGORIES,
  type DemandMapResponse,
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
  const [data, setData] = useState<DemandMapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDemandMap(dealId, { radiusMiles, categories: DEFAULT_CATEGORIES });
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

  return (
    <section className="panel">
      <h2>IC Deck — IOS Demand Map</h2>
      <p className="muted">
        Nearby tenants by IOS use category (auto storage, building materials, chemical/waste,
        container storage, contractor yards, equipment rental &amp; sales), pulled live from
        Google Places, with a satellite basemap for the IC deck.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 0" }}>
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
              alt="Satellite basemap"
              style={{ width: "100%", display: "block", borderRadius: 6 }}
            />
            <svg
              viewBox="0 0 2560 2048"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
            >
              <circle cx={preview.site.x} cy={preview.site.y} r={22} fill="#FF5A4E" stroke="white" strokeWidth={4} />
              {preview.tenants.map((t, i) => {
                const color =
                  DEFAULT_CATEGORIES.find((c) => c.label === t.category)?.color || "999999";
                return (
                  <g key={t.placeId}>
                    <circle cx={t.px.x} cy={t.px.y} r={18} fill={`#${color}`} stroke="white" strokeWidth={3} />
                    <text
                      x={t.px.x}
                      y={t.px.y}
                      fontSize={16}
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
            </svg>
          </div>

          <p className="hint" style={{ marginTop: 8 }}>
            {data.tenants.length} tenants found within {data.radiusMiles} mi of {data.address}.
          </p>

          <div className="metrics-grid" style={{ marginTop: 8 }}>
            {DEFAULT_CATEGORIES.map((cat) => {
              const items = data.tenants
                .map((t, i) => ({ ...t, num: i + 1 }))
                .filter((t) => t.category === cat.label)
                .sort((a, b) => a.distanceMi - b.distanceMi);
              if (!items.length) return null;
              return (
                <div key={cat.label}>
                  <span className="label">
                    {cat.label} ({items.length})
                  </span>
                  <span className="value" style={{ fontSize: 13, fontWeight: 400 }}>
                    {items.map((t) => `${t.num}. ${t.name} (${t.distanceMi.toFixed(1)} mi)`).join(", ")}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
