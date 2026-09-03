"use client";
// components/MapView.tsx
//
// One map component for every map in the app: comps by market, all comps, and
// the deal pipeline. Leaflet with OpenStreetMap tiles -- no API key, so nothing
// is exposed to the browser and there's no per-load cost.
//
// Two implementation notes worth knowing before editing:
//
//  * Leaflet touches `window` at module load, so it is imported inside an
//    effect rather than at the top of the file. A static import would break
//    the server render.
//  * Markers are circleMarkers, not Leaflet's default pin. The default pin
//    loads marker-icon.png by a path that bundlers rewrite, which is the
//    classic "markers are invisible in production" bug -- and circles take a
//    fill colour directly, which is the whole point here.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
// Leaflet's stylesheet is required for tiles to position correctly -- without
// it every tile stacks at the top-left corner. Imported statically (not in the
// effect) so it's in the bundle's CSS rather than injected after paint.
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  /** Hex without the leading #. */
  color: string;
  /** Bold first line of the popup. */
  title: string;
  /** Plain lines under the title. */
  lines?: string[];
  /** Makes the popup title a link. */
  href?: string;
  /** Larger, outlined -- used for the subject property. */
  emphasis?: boolean;
}

export interface MapLegendItem {
  label: string;
  color: string;
  count?: number;
}

export default function MapView({
  points,
  legend,
  height = 460,
  emptyMessage = "Nothing to show on the map yet.",
}: {
  points: MapPoint[];
  legend?: MapLegendItem[];
  height?: number;
  emptyMessage?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const router = useRouter();

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !containerRef.current || mapRef.current) return;

        const map = L.map(containerRef.current, {
          scrollWheelZoom: true,
          // Pinch-zoom and two-finger pan on a trackpad or touchscreen.
          touchZoom: true,
          zoomControl: true,
          // Set on the map, not left to be inferred from whichever layers
          // happen to be attached -- switching basemaps would otherwise change
          // how far you're allowed to zoom.
          maxZoom: 21,
        });
        // Base layers, all keyless -- nothing here ships a credential to the
        // browser or bills per load.
        //
        // Esri World Imagery is the sharpest option in Texas metros and is the
        // near-universal default for keyless Leaflet satellite. USGS Imagery is
        // offered alongside it because it's unambiguously public domain (a US
        // government product) where Esri's basemap terms lean toward ArcGIS
        // subscribers -- so if legal ever asks, there's a clean fallback that
        // needs no negotiation. Both are US-only at high zoom, which is fine
        // for a Texas portfolio.
        // maxZoom vs maxNativeZoom is the whole trick here.
        //
        // maxNativeZoom is the deepest zoom the SERVER has tiles for; maxZoom
        // is how far the map lets you go. Without maxNativeZoom, zooming past
        // a source's limit makes Leaflet request tiles that don't exist and
        // paint grey. With it, Leaflet upscales the deepest real tile instead:
        // the imagery goes soft rather than blank.
        //
        // The limits below were measured over Conroe rather than assumed --
        // OSM returns HTTP 400 above z19, and USGS ImageryOnly 404s from z17,
        // which is far shallower than its docs imply.
        const MAX_ZOOM = 21;

        const street = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: MAX_ZOOM,
          maxNativeZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        });
        const esriImagery = L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          {
            maxZoom: MAX_ZOOM,
            maxNativeZoom: 21,
            attribution:
              "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
          }
        );
        // Transparent roads and place names over the imagery. Without them
        // you're looking at rooftops with no idea which highway you're beside.
        // Two layers because Esri splits them: Transportation carries the
        // roads, Boundaries_and_Places the names.
        const esriRoads = L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: MAX_ZOOM, maxNativeZoom: 21, attribution: "" }
        );
        const esriPlaces = L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: MAX_ZOOM, maxNativeZoom: 21, attribution: "" }
        );
        const usgsImagery = L.tileLayer(
          "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
          {
            maxZoom: MAX_ZOOM,
            // Measured: 404s from z17, so anything deeper is an upscale.
            maxNativeZoom: 16,
            attribution:
              'Imagery courtesy of <a href="https://www.usgs.gov/">USGS</a> — public domain',
          }
        );

        const bases: Record<string, any> = {
          Street: street,
          Satellite: L.layerGroup([esriImagery, esriRoads, esriPlaces]),
          "Satellite (no labels)": esriImagery,
          "Satellite (USGS, low detail)": usgsImagery,
        };

        // The choice persists across pages, so picking satellite once holds for
        // the pipeline map and the comps map both.
        let initial = "Street";
        try {
          const saved = window.localStorage.getItem("hopper.mapLayer");
          if (saved && bases[saved]) initial = saved;
        } catch {
          // Private browsing or storage disabled -- the default is fine.
        }
        bases[initial].addTo(map);
        L.control.layers(bases, undefined, { position: "topright" }).addTo(map);
        map.on("baselayerchange", (e: any) => {
          try {
            window.localStorage.setItem("hopper.mapLayer", e.name);
          } catch {
            // Not worth surfacing; the map still works.
          }
        });

        map.setView([31.0, -97.0], 6); // Texas, until points arrive
        mapRef.current = map;
      } catch (err: any) {
        setFailed(err?.message ?? "Could not load the map");
      }
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Redraw markers whenever the points change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      if (cancelled || !map) return;

      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      if (!points.length) return;

      const group = L.featureGroup();
      for (const p of points) {
        // White outline rather than dark: it reads against both the pale
        // street basemap and dark satellite imagery, where a near-black stroke
        // vanishes into rooftops and asphalt.
        const marker = L.circleMarker([p.lat, p.lng], {
          radius: p.emphasis ? 11 : 7,
          color: "#ffffff",
          weight: p.emphasis ? 3 : 2,
          fillColor: `#${p.color}`,
          fillOpacity: 0.95,
        });
        const body = (p.lines ?? []).map((l) => escapeHtml(l)).join("<br/>");
        const card = (titleHtml: string) =>
          `<div style="font:13px -apple-system,Segoe UI,Arial,sans-serif;min-width:150px">${titleHtml}${
            body ? `<div style="color:#5b6472;margin-top:3px">${body}</div>` : ""
          }</div>`;

        if (p.href) {
          // Clicking a pin opens its summary. The detail that would have been
          // in a popup moves to the hover tooltip, so nothing is lost -- and a
          // popup would only flash before the navigation anyway.
          marker.bindTooltip(
            card(`<strong>${escapeHtml(p.title)}</strong>`) +
              `<div style="color:#2e6e62;margin-top:4px;font-size:12px">Click to open →</div>`,
            { direction: "top", sticky: true, opacity: 1 }
          );
          marker.on("click", () => router.push(p.href!));
          // Make the affordance obvious on the way in.
          marker.on("mouseover", () => {
            const el = (marker as any)._path as SVGElement | undefined;
            if (el) el.style.cursor = "pointer";
          });
        } else {
          marker.bindPopup(card(`<strong>${escapeHtml(p.title)}</strong>`));
          marker.bindTooltip(p.title, { direction: "top" });
        }
        group.addLayer(marker);
      }
      group.addTo(map);
      layerRef.current = group;

      const bounds = group.getBounds();
      if (bounds.isValid()) {
        // A single point has zero-size bounds, which fitBounds zooms to street
        // level -- too close to give any context.
        if (points.length === 1) map.setView([points[0].lat, points[0].lng], 13);
        else map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [points, router]);

  if (failed) {
    return <p className="error">Map failed to load: {failed}</p>;
  }

  return (
    <>
      <div
        ref={containerRef}
        className="map-view"
        style={{ height }}
        role="application"
        aria-label="Map"
      />
      {points.length === 0 && <p className="muted">{emptyMessage}</p>}
      {legend && legend.length > 0 && (
        <div className="map-legend">
          {legend.map((item) => (
            <span key={item.label} className="map-legend-item">
              <span className="map-legend-dot" style={{ background: `#${item.color}` }} />
              {item.label}
              {item.count !== undefined && <span className="muted"> {item.count}</span>}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
