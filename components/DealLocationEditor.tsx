"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MapView from "./MapView";
import { hasMapCoordinates } from "@/lib/comps/mapData";

export default function DealLocationEditor({ dealId, address, latitude, longitude }: {
  dealId: string; address: string; latitude: number | null; longitude: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lat, setLat] = useState(latitude == null ? "" : String(latitude));
  const [lng, setLng] = useState(longitude == null ? "" : String(longitude));
  const [pair, setPair] = useState("");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(
    hasMapCoordinates({ latitude, longitude }) ? { lat: latitude!, lng: longitude! } : null
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const attempted = useRef(false);
  useEffect(() => {
    setLat(latitude == null ? "" : String(latitude));
    setLng(longitude == null ? "" : String(longitude));
    setPin(hasMapCoordinates({latitude,longitude}) ? {lat:Number(latitude),lng:Number(longitude)} : null);
    attempted.current = false;
  }, [address, latitude, longitude]);
  async function lookup() {
    setBusy(true); setError(""); setMessage("Checking Google Maps…");
    try {
      const res = await fetch(`/api/deals/${dealId}/location`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Lookup failed");
      if (body.needsManual) { setMessage(body.message); return; }
      const a = Number(body.property.latitude), b = Number(body.property.longitude);
      setLat(String(a)); setLng(String(b)); setPin({ lat: a, lng: b });
      setMessage(body.existing ? "Using the saved location." : `Google matched ${body.matchedAddress}. Location saved.`);
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Lookup failed. Enter coordinates below."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!open || attempted.current || hasMapCoordinates({ latitude, longitude })) return;
    attempted.current = true;
    void lookup();
  }, [open]);
  function preview(a = lat, b = lng) {
    if (!a.trim() || !b.trim() || !hasMapCoordinates({ latitude: a, longitude: b })) {
      setError("Enter a valid latitude and longitude before previewing or saving.");
      return false;
    }
    setPin({ lat: Number(a), lng: Number(b) });
    setError("");
    return true;
  }
  async function save() {
    if (!preview()) return;
    setBusy(true); setMessage("");
    try {
      const res = await fetch(`/api/deals/${dealId}/location`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: Number(lat), longitude: Number(lng) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save location");
      setMessage("Location saved. Nearby assets and comps are refreshing.");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save location"); }
    finally { setBusy(false); }
  }
  return <details id="location" className="panel" onToggle={(e) => setOpen(e.currentTarget.open)}>
    <summary>Add or correct location</summary>
    <p>New deals check Google automatically. Opening this panel checks existing deals without coordinates; if no confident match is found, use the manual controls below.</p>
    <button type="button" className="secondary" disabled={busy} onClick={lookup}>{busy ? "Checking / saving…" : "Check Google Maps"}</button>
    <p>Set the location of <strong>{address}</strong> to calculate nearby assets and comps. Paste coordinates, or click the map at the property.</p>
    <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
      <label>Paste latitude, longitude
        <input value={pair} onChange={(e) => setPair(e.target.value)} placeholder="30.2672, -97.7431" />
      </label>
      <button type="button" className="secondary" onClick={() => {
        const parts = pair.trim().split(/[,\s]+/);
        if (parts.length !== 2) { setError("Paste two coordinates: latitude, longitude."); return; }
        if (preview(parts[0], parts[1])) { setLat(parts[0]); setLng(parts[1]); setMessage(""); }
      }}>Preview pasted coordinates</button>
      <div className="grid-2">
        <label>Latitude<input type="number" step="any" min="-90" max="90" value={lat} onChange={(e) => { setLat(e.target.value); setMessage(""); }} /></label>
        <label>Longitude<input type="number" step="any" min="-180" max="180" value={lng} onChange={(e) => { setLng(e.target.value); setMessage(""); }} /></label>
      </div>
      <button type="button" className="secondary" onClick={() => preview()}>Preview location</button>
      {open && <MapView height={360} points={pin ? [{ id: "location", ...pin, title: address, color: "FF5A4E", emphasis: true }] : []}
        onPick={(a, b) => { if (busy) return; setLat(String(a)); setLng(String(b)); setPin({ lat: a, lng: b }); setError(""); setMessage(""); }}
        emptyMessage="No saved location. Paste coordinates or click the map to place this property." />}
      <p className="hint">Right-click the property in Google Maps to copy coordinates. Check the preview before saving. This updates the property location for every deal using this property.</p>
      <button type="button" onClick={save}>{busy ? "Saving…" : "Save location"}</button>
    </fieldset>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </details>;
}
