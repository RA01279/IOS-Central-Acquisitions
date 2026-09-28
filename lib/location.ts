/** Shared intake and map validation; never coerce blank coordinates to zero. */
export function validCoordinates(value: { latitude?: unknown; longitude?: unknown }): boolean {
  const values = [value.latitude, value.longitude];
  if (values.some(v => !["string", "number"].includes(typeof v) || String(v).trim() === "")) return false;
  const [lat, lng] = values.map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

export function locationReady(value: { latitude?: unknown; longitude?: unknown; geocode_precision?: string | null }): boolean {
  return validCoordinates(value) && ["rooftop", "range_interpolated", "geometric_center", "manual", "supplied"].includes(value.geocode_precision ?? "");
}

export function parseCoordinatePair(text: string): { latitude: number; longitude: number } | null {
  const match = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const point = { latitude: Number(match[1]), longitude: Number(match[2]) };
  return validCoordinates(point) ? point : null;
}
