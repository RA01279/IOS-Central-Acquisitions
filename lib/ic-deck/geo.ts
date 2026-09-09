// lib/ic-deck/geo.ts
//
// Web Mercator, matching Google's Static Maps projection exactly.
//
// Extracted from iosDemandMap.ts when the portfolio map needed the same
// arithmetic. Both draw their own pins on top of a plain basemap rather than
// asking the API for markers -- which is what makes custom shapes, labels and
// distance rings possible, and sidesteps the URL length limit that a few dozen
// `markers=` parameters would hit. Getting this wrong puts every pin slightly
// off, consistently enough to look deliberate, so there is exactly one copy.

export const METERS_PER_MILE = 1609.34;
export const LOCATED_PRECISIONS = ["rooftop", "range_interpolated", "geometric_center", "supplied", "manual"];

/** Pixel coordinates in Google's world space at a given zoom. */
export function latLngToWorldPixel(lat: number, lng: number, zoom: number) {
  const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  const scale = 256 * 2 ** zoom;
  const x = (0.5 + lng / 360) * scale;
  const y = (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/** Ground distance covered by one logical map pixel, in meters. */
export function metersPerLogicalPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Ground distance covered by one logical map pixel, in miles. */
export function milesPerLogicalPixel(lat: number, zoom: number): number {
  return metersPerLogicalPixel(lat, zoom) / METERS_PER_MILE;
}

/** Straight-line miles between two points. */
export function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.7613;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const q =
    Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  const clamped = Math.min(1, Math.max(0, q));
  return R * 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

/**
 * The deepest zoom whose square image still covers `radiusMiles` from the
 * centre in every direction. Integer, because Static Maps only accepts
 * integer zooms -- so it rounds DOWN to the zoom that still fits, never up to
 * one that would crop the outermost pins off the image.
 */
export function zoomForRadiusMiles(radiusMiles: number, lat: number, logicalSize = 640): number {
  for (let zoom = 20; zoom >= 1; zoom--) {
    const halfExtent = (logicalSize / 2) * milesPerLogicalPixel(lat, zoom);
    if (halfExtent >= radiusMiles) return zoom;
  }
  return 1;
}

/**
 * Everything needed to draw on top of a square basemap, in slide inches.
 *
 * Holds only if the image is drawn square and uncropped at `mapSideInches` --
 * stretch it and every pin drifts.
 */
export function mapGeometryFor(
  centerLat: number,
  centerLng: number,
  zoom: number,
  logicalSize: number,
  mapSideInches: number
) {
  const inPerLogicalPx = mapSideInches / logicalSize;
  const miPerLogicalPx = milesPerLogicalPixel(centerLat, zoom);
  const centerPx = latLngToWorldPixel(centerLat, centerLng, zoom);

  return {
    inchesPerMile: inPerLogicalPx / miPerLogicalPx,
    halfExtentMi: (logicalSize / 2) * miPerLogicalPx,
    /** Offset from the map centre in inches (dx right, dy down). */
    offsetInches(lat: number, lng: number) {
      const p = latLngToWorldPixel(lat, lng, zoom);
      return { dx: (p.x - centerPx.x) * inPerLogicalPx, dy: (p.y - centerPx.y) * inPerLogicalPx };
    },
  };
}
