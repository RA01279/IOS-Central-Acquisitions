"use client";
// components/DemandMapView.tsx
//
// The IOS demand map (design 2c / 3b): map and data side by side, with radius
// 1/3/5 mi and one toggle per demand category. The view state lives in the
// URL (?r=3&cats=truck,equip) so a teammate who opens the link -- or the IC
// Deck tab, which reads the same params -- sees exactly this map.
//
// Data is the deal's stored demand snapshot (a 5 mi Places search, see
// lib/site-signals.ts). Changing radius or categories never re-queries Google;
// it only re-counts what the snapshot already holds.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, RefreshCw } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { DEMAND_CATEGORIES, RADII, hex, scoreState, signal } from "@/lib/hopper-tokens";
import { demandBreakdown, type DemandSnapshot } from "@/lib/site-score";
import { CategoryIcon } from "./ui";

const METERS_PER_MILE = 1609.34;

export default function DemandMapView({
  dealId,
  center,
  snapshot,
  initialRadius,
  initialCats,
}: {
  dealId: string;
  center: { lat: number; lng: number } | null;
  snapshot: DemandSnapshot | null;
  initialRadius: number;
  initialCats: string[] | null;
}) {
  const router = useRouter();
  const [radius, setRadius] = useState(initialRadius);
  const [cats, setCats] = useState<string[]>(initialCats ?? DEMAND_CATEGORIES.map((c) => c.key));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);

  const pt = snapshot?.center ?? center;
  const { rows, total, index } = useMemo(() => demandBreakdown(snapshot, radius, cats), [snapshot, radius, cats]);
  const di = signal[scoreState(index)];
  const strongest = rows.filter((r) => cats.includes(r.key) && r.state === "strong").sort((a, b) => b.count - a.count);
  const sentence = !snapshot
    ? "No demand search has been run for this site yet."
    : !cats.length
      ? "Turn on at least one category to score demand."
      : `${total} likely tenant${total === 1 ? "" : "s"} within ${radius} mi.` +
        (strongest.length
          ? ` Strongest: ${strongest.slice(0, 2).map((r) => r.label).join(" and ")}.`
          : " No category is strong at this radius.");
  const nearby = (snapshot?.tenants ?? [])
    .filter((t) => t.distanceMi <= radius && cats.includes(DEMAND_CATEGORIES.find((c) => c.label === t.category)?.key ?? ""))
    .sort((a, b) => a.distanceMi - b.distanceMi)
    .slice(0, 5);

  // Keep the URL in step so Copy Link / share / the IC tab get this exact view.
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("r", String(radius));
    if (cats.length === DEMAND_CATEGORIES.length) u.searchParams.delete("cats");
    else u.searchParams.set("cats", cats.join(",") || "none");
    // Next.js syncs replaceState into useSearchParams, so the tab links (which
    // carry r & cats to the IC Deck tab) update without a navigation.
    window.history.replaceState(null, "", u.toString());
  }, [radius, cats]);

  // Map: created once.
  useEffect(() => {
    if (!pt || !mapEl.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || mapRef.current || !mapEl.current) return;
      LRef.current = L;
      const map = L.map(mapEl.current, { zoomControl: true, attributionControl: true });
      const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 20,
        subdomains: "abcd",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO',
      });
      const sat = L.layerGroup([
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 20,
          attribution: "Tiles &copy; Esri",
        }),
        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 20 }
        ),
      ]);
      light.addTo(map);
      L.control.layers({ Map: light, Satellite: sat }, undefined, { position: "topright" }).addTo(map);
      map.setView([pt.lat, pt.lng], 12);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      draw();
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pt?.lat, pt?.lng]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius, cats, snapshot]);

  function draw() {
    const L = LRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer || !pt) return;
    layer.clearLayers();
    for (const m of RADII) {
      const on = m === radius;
      L.circle([pt.lat, pt.lng], {
        radius: m * METERS_PER_MILE,
        color: on ? "#0E5AA7" : "#9AA8B5",
        weight: on ? 2 : 1,
        dashArray: on ? undefined : "4 4",
        fillColor: "#0E5AA7",
        fillOpacity: on ? 0.06 : 0,
        interactive: false,
      }).addTo(layer);
      const east = L.latLng(pt.lat, pt.lng + (m * METERS_PER_MILE) / (111320 * Math.cos((pt.lat * Math.PI) / 180)));
      L.marker(east, {
        interactive: false,
        icon: L.divIcon({
          className: "",
          html: `<span style="font:600 10px/1 var(--font-mono);color:${on ? "#0E5AA7" : "#6B7A88"};background:rgba(255,255,255,.85);padding:2px 4px;margin-left:-18px;white-space:nowrap">${m} mi</span>`,
        }),
      }).addTo(layer);
    }
    for (const t of snapshot?.tenants ?? []) {
      const c = DEMAND_CATEGORIES.find((x) => x.label === t.category);
      if (!c || !cats.includes(c.key)) continue;
      const inside = t.distanceMi <= radius;
      L.circleMarker([t.lat, t.lng], {
        radius: 6,
        color: "#fff",
        weight: 2,
        fillColor: hex(c.color),
        fillOpacity: inside ? 1 : 0.28,
        opacity: inside ? 1 : 0.28,
      })
        .bindPopup(`<strong>${escapeHtml(t.name)}</strong><br>${escapeHtml(c.label)} · ${t.distanceMi.toFixed(1)} mi`)
        .addTo(layer);
    }
    L.marker([pt.lat, pt.lng], {
      zIndexOffset: 1000,
      icon: L.divIcon({
        className: "dm-subject",
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        html: `<div></div><span style="position:absolute;left:24px;top:-12px;padding:4px 7px;background:#0A2540;color:#fff;font:600 11px/1 var(--font-body);border-radius:2px;white-space:nowrap">Subject site</span>`,
      }),
    }).addTo(layer);
    map.fitBounds(L.latLng(pt.lat, pt.lng).toBounds(radius * 2 * METERS_PER_MILE * 1.08), { animate: false });
  }

  async function runSearch() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/deals/${dealId}/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh", demand: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Search failed");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(key: string) {
    setCats((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  }

  return (
    <div className="dm-split">
      <div className="dm-map">
        {pt ? (
          <div ref={mapEl} style={{ position: "absolute", inset: 0 }} />
        ) : (
          <div className="dm-placeholder">
            <strong>No verified map pin</strong>
            <span>Set the location below, then run the demand search.</span>
          </div>
        )}
      </div>
      <div className="dm-panel">
        <span className="sheet-grip" />
        <div className="dm-head">
          <div className="score lg" style={{ background: hex(di.bg), color: hex(di.fg) }}>
            <b>{index ?? "—"}</b>
            <span>Index</span>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="overline-muted" style={{ color: hex(di.fg) }}>
              {snapshot ? `${di.label} tenant demand` : "Tenant demand"}
            </span>
            <span style={{ font: "400 12px/1.45 var(--font-body)", color: "#364049" }}>{sentence}</span>
          </div>
        </div>
        <div className="dm-radius">
          <span className="overline-muted">Radius</span>
          <div className="seg">
            {RADII.map((m) => (
              <button key={m} type="button" className={m === radius ? "on" : ""} onClick={() => setRadius(m)}>
                {m} mi
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <button type="button" className="link-caps" onClick={runSearch} disabled={busy || !pt} title="Re-runs the Google Places search (costs API calls)">
            <RefreshCw size={11} className={busy ? "spin" : ""} style={{ verticalAlign: -1, marginRight: 4 }} />
            {busy ? "Searching…" : snapshot ? `Cached ${new Date(snapshot.fetchedAt).toLocaleDateString()}` : "Run demand search"}
          </button>
        </div>
        {error && <p className="error" style={{ padding: "8px 20px", margin: 0 }}>{error}</p>}
        <div className="dm-cats">
          {rows.map((r) => {
            const on = cats.includes(r.key);
            const s = signal[r.state];
            return (
              <button key={r.key} type="button" className="dm-cat" onClick={() => toggle(r.key)} style={{ opacity: on ? 1 : 0.4 }} aria-pressed={on}>
                <span className="dm-cat-row">
                  <span className="dm-check" style={{ border: `1.5px solid ${hex(r.color)}`, background: on ? hex(r.color) : "#fff" }}>
                    {on && <Check size={11} color="#fff" strokeWidth={3} />}
                  </span>
                  <CategoryIcon k={r.key} size={18} color="#0A2540" />
                  <span className="dm-cat-name">{r.label}</span>
                  <span className="dm-cat-count">{snapshot ? r.count : "—"}</span>
                  <span className="dm-sig" style={{ background: hex(snapshot ? s.bg : signal.unknown.bg), color: hex(snapshot ? s.fg : signal.unknown.fg) }}>
                    {snapshot ? s.label : "—"}
                  </span>
                </span>
                <span className="dm-cat-bar">
                  <div style={{ width: `${Math.round(r.share * 100)}%`, background: hex(r.color) }} />
                </span>
              </button>
            );
          })}
        </div>
        <div className="dm-near">
          <span className="overline-muted">Nearest likely tenants</span>
          {nearby.length ? (
            nearby.map((t) => {
              const c = DEMAND_CATEGORIES.find((x) => x.label === t.category);
              return (
                <div key={t.placeId} className="dm-near-row">
                  <i style={{ background: hex(c?.color ?? "9AA8B5") }} />
                  <span>{t.name}</span>
                  <b className="mono" style={{ fontWeight: 400, color: "#6B7A88" }}>
                    {t.distanceMi.toFixed(1)} mi
                  </b>
                </div>
              );
            })
          ) : (
            <span className="hint" style={{ margin: 0 }}>{snapshot ? "None in range for the selected categories." : "Run the search to list them."}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
