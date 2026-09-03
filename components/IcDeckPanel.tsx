"use client";

import { useMemo, useState } from "react";
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
  // Keyword screening gets most of the junk, but an IC deck shouldn't rely on
  // heuristics for the last mile -- anything that isn't a real yard user can be
  // dropped here, and the map, numbering, and deck all follow.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
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
      setExcluded(new Set());
    } catch (e: any) {
      setError(e.message || "Failed to generate demand map");
    } finally {
      setLoading(false);
    }
  }

  // Everything downstream reads `view`, never `data` -- so pin numbers, the
  // density bands, the totals and the exported deck can't disagree with what's
  // on screen.
  const view = useMemo<DemandMapResponse | null>(
    () =>
      data ? { ...data, tenants: data.tenants.filter((t) => !excluded.has(t.placeId)) } : null,
    [data, excluded]
  );

  async function handleExport() {
    if (!view) return;
    setExporting(true);
    setError(null);
    try {
      await exportToPptx(
        view,
        {
          subtitle: addressForSubtitle
            ? `${addressForSubtitle}  |  ${view.tenants.length} potential IOS users within a ${view.radiusMiles}-mile radius`
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

  function toggle(placeId: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  }

  const preview = view ? computePixelPositions(view) : null;
  const halfExtent = view ? halfExtentMiles(view) : 0;
  const rings = view ? ringMiles(view.radiusMiles, halfExtent) : [];
  const bands = view ? densityByBand(view.tenants, rings) : [];

  return (
    <section className="panel">
      <h2>IC Deck — IOS Demand Map</h2>
      <p className="muted">
        Yard-occupying businesses near the site, by use category, pulled live from Google Places
        on a true-colour satellite basemap. Self-storage, movers, residential remodelers, and
        showrooms are screened out; anything else that isn&apos;t a real IOS user can be removed
        below before exporting.
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
        {view && (
          <button onClick={handleExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export IC Deck (.pptx)"}
          </button>
        )}
      </div>

      {error && <p className="warning">{error}</p>}

      {data && view && preview && (
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
            {view.tenants.length} IOS users within {view.radiusMiles} mi of {data.address}
            {bands.length > 0 && (
              <> · {bands.map((b) => `${b.count} within ${b.mi} mi`).join(" · ")}</>
            )}
          </p>
          <p className="hint">
            {typeof data.screenedOut === "number" && data.screenedOut > 0 && (
              <>{data.screenedOut} keyword matches screened out as non-yard uses. </>
            )}
            {excluded.size > 0 && (
              <>
                {excluded.size} removed by hand.{" "}
                <button
                  type="button"
                  className="secondary"
                  style={{ padding: "2px 8px", fontSize: 12 }}
                  onClick={() => setExcluded(new Set())}
                >
                  Restore all
                </button>
              </>
            )}
          </p>

          <div className="dash-cols" style={{ marginTop: 8 }}>
            {DEFAULT_CATEGORIES.map((cat) => {
              // Numbering comes from the visible list, so the key matches the pins.
              const numbered = view.tenants.map((t, i) => ({ ...t, num: i + 1 }));
              const items = numbered
                .filter((t) => t.category === cat.label)
                .sort((a, b) => a.distanceMi - b.distanceMi);
              const removed = data.tenants.filter(
                (t) => t.category === cat.label && excluded.has(t.placeId)
              );
              if (!items.length && !removed.length) return null;
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
                  <ul className="doc-list" style={{ gap: 3, fontSize: 13 }}>
                    {items.map((t) => (
                      <li key={t.placeId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <strong style={{ color: `#${cat.color}`, minWidth: 16, textAlign: "right" }}>
                          {t.num}
                        </strong>
                        {/* Logo gutter is always reserved so names line up even
                            though ~a quarter of tenants have no usable icon. */}
                        <span
                          style={{
                            width: 18,
                            height: 18,
                            flex: "0 0 18px",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {t.logoBase64 && (
                            <img
                              src={t.logoBase64}
                              alt=""
                              width={18}
                              height={18}
                              style={{ borderRadius: 3, objectFit: "contain" }}
                            />
                          )}
                        </span>
                        {t.website ? (
                          <a href={t.website} target="_blank" rel="noopener noreferrer">
                            {t.name}
                          </a>
                        ) : (
                          <span>{t.name}</span>
                        )}
                        <span className="muted">· {t.distanceMi.toFixed(1)} mi</span>
                        <button
                          type="button"
                          className="link-remove"
                          title="Not an IOS user — remove from the map and deck"
                          onClick={() => toggle(t.placeId)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                    {removed.map((t) => (
                      <li
                        key={t.placeId}
                        style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.5 }}
                      >
                        <span style={{ minWidth: 16 }} />
                        <span style={{ width: 18, flex: "0 0 18px" }} />
                        <span style={{ textDecoration: "line-through" }}>{t.name}</span>
                        <button
                          type="button"
                          className="secondary"
                          style={{ padding: "1px 6px", fontSize: 11 }}
                          onClick={() => toggle(t.placeId)}
                        >
                          undo
                        </button>
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
