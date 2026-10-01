"use client";
// components/CompLocationFixer.tsx
//
// Resolve a comp that can't be distance-matched, on the page that tells you it
// can't be.
//
// The banner used to say "fix the address below to place it", which is wrong
// advice for the addresses that actually hit this. Google always answers: where
// it can't resolve a street address it hands back the city or ZIP centroid
// flagged APPROXIMATE, and the matcher refuses to measure from that -- rightly,
// since the middle of a postcode isn't where the deal is. But no rewriting of
// "IH10 East BTS", "Beltway 8 & Fellows Road" or "Victory Circle" will ever
// geocode, because there is no street number to find.
//
// So the fix is to point at the spot. Click the map, confirm, done -- which
// beats copying two numbers out of another browser tab, and is the same gesture
// people already use to read these maps.

import Link from "next/link";
import { validCoordinates } from "@/lib/location";
import { useState } from "react";
import { useRouter } from "next/navigation";
import MapView, { type MapPoint } from "./MapView";

const PIN_COLOR = "FF5A4E";
const CURRENT_COLOR = "9AA5B1";

export default function CompLocationFixer({
  compId,
  address,
  precision,
  currentLat,
  currentLng,
}: {
  compId: string;
  address: string;
  precision: string | null;
  currentLat: number | null;
  currentLng: number | null;
}) {
  const router = useRouter();
  const [pick, setPick] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [saved, setSaved] = useState(false);

  const points: MapPoint[] = [];
  if (currentLat != null && currentLng != null) {
    points.push({
      id: "__current",
      lat: currentLat,
      lng: currentLng,
      color: CURRENT_COLOR,
      title: `Where it sits now (${precision ?? "no geocode"})`,
      lines: ["Saved location"],
    });
  }
  if (pick) {
    points.push({
      id: "__pick",
      lat: pick.lat,
      lng: pick.lng,
      color: PIN_COLOR,
      title: address,
      lines: [`${pick.lat.toFixed(6)}, ${pick.lng.toFixed(6)}`, "Click Save to keep this"],
      emphasis: true,
    });
  }

  /** Accepts what Google Maps puts on the clipboard: "32.0817, -81.1256". */
  function applyTyped() {
    const m = typed.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) {
      setError('Paste a coordinate pair, like "32.0817, -81.1256".');
      return;
    }
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (!validCoordinates({ latitude: lat, longitude: lng })) {
      setError(`Those are off the map (${lat}, ${lng}). Latitude is -90 to 90, longitude -180 to 180.`);
      return;
    }
    setError(null);
    setSaved(false);
    setPick({ lat, lng });
  }

  async function save() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/comps/${compId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: pick.lat, longitude: pick.lng }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save that location");
      if (!body.comp || Number(body.comp.latitude) !== pick.lat || Number(body.comp.longitude) !== pick.lng) throw new Error("The saved location did not match. Refresh and try again.");
      setPick(null);
      setSaved(true);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>{currentLat != null && currentLng != null ? "Edit comp location" : "Add comp location"}</h2>
      <p className="hint">
        Place <strong>{address}</strong> by clicking the property on the map or pasting
        coordinates below. Switch to Satellite to find the site. The grey marker is the
        saved location; your new pin is a preview until you save.
      </p>
      {saved && <p role="status">Location saved. <Link href="/comps">View on the comps map</Link>.</p>}

      <MapView
        points={points}
        height={420}
        onPick={(lat, lng) => {
          setError(null);
          setSaved(false);
    setPick({ lat, lng });
        }}
        emptyMessage="Click anywhere on the map to place this comp."
        legend={
          currentLat != null
            ? [
                { label: "Where it sits now", color: CURRENT_COLOR },
                ...(pick ? [{ label: "Your pin", color: PIN_COLOR }] : []),
              ]
            : pick
              ? [{ label: "Your pin", color: PIN_COLOR }]
              : undefined
        }
      />

      <div className="stage-actions" style={{ marginTop: 12 }}>
        <button onClick={save} disabled={busy || !pick}>
          {busy ? "Saving…" : pick ? "Save this location" : "Click the map to place it"}
        </button>
        {pick && (
          <>
            <button type="button" className="secondary" onClick={() => setPick(null)}>
              Clear pin
            </button>
            <span className="muted" style={{ alignSelf: "center" }}>
              {pick.lat.toFixed(6)}, {pick.lng.toFixed(6)}
            </span>
          </>
        )}
      </div>

      {/* For anyone who already has the numbers -- surveyor's coordinates, or a
          right-click in Google Maps, which copies exactly this format. */}
      <details className="comp-rentroll" style={{ marginTop: 12 }}>
        <summary>Or paste coordinates</summary>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyTyped();
              }
            }}
            aria-label="Latitude, longitude"
            placeholder="32.0817, -81.1256"
            style={{ minWidth: 220 }}
          />
          <button type="button" className="secondary" onClick={applyTyped}>
            Drop pin here
          </button>
        </div>
        <p className="hint">
          Right-click the spot in Google Maps and click the coordinates it shows — that copies them
          in exactly this format. Dropping the pin only previews it; Save is what keeps it.
        </p>
      </details>

      {error && <p className="error">{error}</p>}
      <p className="hint" style={{ marginTop: 10 }}>
        Saved locations are used on the comps map and for distance matching. Changing an
        address requires a verified location or a replacement pin.
      </p>
    </section>
  );
}
