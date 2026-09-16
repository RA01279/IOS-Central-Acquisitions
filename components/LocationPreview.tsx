"use client";
import { useEffect, useRef, useState } from "react";
import MapView from "./MapView";
import { parseCoordinatePair, validCoordinates } from "@/lib/location";

export interface LocationPoint { latitude: number; longitude: number; geocode_precision: string }

export default function LocationPreview({ address, city, market, state, value, onChange }: {
  address: string; city?: string | null; market?: string | null; state?: string | null;
  value: LocationPoint | null; onChange: (point: LocationPoint | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [message, setMessage] = useState("");
  const [typed, setTyped] = useState("");
  const [showMap, setShowMap] = useState(false);
  async function lookup() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/locations/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, city, market, state }) });
      const result = await response.json();
      if (!active.current) return;
      if (!response.ok) throw new Error(result.error ?? "Location lookup failed");
      onChange(result.location);
      setMessage(result.matchedAddress ?? result.message);
      setShowMap(true);
    } catch (error: any) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <div style={{ minWidth: 230 }}>
    <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
    <p className="hint" role="status">{value && validCoordinates(value) ? `Map ready (${["rooftop","geometric_center"].includes(value.geocode_precision) ? "Google address match" : value.geocode_precision}) · ${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}` : "Needs a verified location before saving"}</p>
    <button type="button" disabled={busy || !address.trim()} onClick={lookup}>{busy ? "Checking Google…" : "Check Google location"}</button>{" "}
    <button type="button" className="secondary" onClick={() => setShowMap(!showMap)}>{showMap ? "Hide map" : "Review / place pin"}</button>
    {message && <p className="hint" role="status">{message}</p>}
    {showMap && <>
      <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([address, city, state || market].filter(Boolean).join(", "))}`}>Find property in Google Maps</a>
      <label>Paste latitude, longitude
        <input value={typed} placeholder="29.909661, -95.504636" onChange={e => { setTyped(e.target.value); const pair = parseCoordinatePair(e.target.value); if (pair) { onChange({ ...pair, geocode_precision: "manual" }); setMessage("Manual coordinates selected. Check the pin before saving."); } }} />
      </label>
      {typed && !parseCoordinatePair(typed) && <p className="error">Enter both coordinates, separated by a comma.</p>}
      <p className="hint">Click the actual property or yard on the map to select its location.</p>
      <MapView height={280} points={value ? [{ id: "selected", lat: value.latitude, lng: value.longitude, color: "C0562B", title: address || "Selected property" }] : []}
        onPick={(latitude, longitude) => { onChange({ latitude, longitude, geocode_precision: "manual" }); setTyped(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`); setMessage("Manual pin selected."); }} />
    </>}
    </fieldset>
  </div>;
}
