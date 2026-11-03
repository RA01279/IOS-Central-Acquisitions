"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { computePixelPositions, DEFAULT_CATEGORIES, type DemandMapResponse } from "@/lib/ic-deck/iosDemandMap";

export default function DemandMapExplorer({ children, data }: { children: ReactNode; data: DemandMapResponse }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const preview = useMemo(() => computePixelPositions(data), [data]);
  const selected = preview.tenants.find(t => t.placeId === selectedId);
  const colocated = selected ? preview.tenants.filter(t => Math.hypot(t.px.x - selected.px.x, t.px.y - selected.px.y) < 1) : [];
  function reset() { setCamera({ zoom: 1, x: 0, y: 0 }); }
  function changeZoom(factor: number, anchor = { x: 0, y: 0 }) {
    setCamera(value => { const zoom = Math.min(20, Math.max(1, value.zoom * factor)); const ratio = zoom / value.zoom;
      return { zoom, x: anchor.x - (anchor.x - value.x) * ratio, y: anchor.y - (anchor.y - value.y) * ratio }; });
  }
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    function wheel(event: WheelEvent) { event.preventDefault(); const rect = element!.getBoundingClientRect(); changeZoom(event.deltaY < 0 ? 1.2 : 1 / 1.2, { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }); }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  return <>
    <button type="button" aria-label="Open Demand Map" onClick={() => { reset(); setSelectedId(null); dialog.current?.showModal(); }}
      style={{ display: "block", padding: 0, width: "100%", maxWidth: 640, marginTop: 8, overflow: "hidden", cursor: "zoom-in", background: "transparent" }}>{children}</button>
    <p className="hint">Click the map to enlarge, then click a numbered business. Zoom in to separate nearby pins.</p>
    <dialog ref={dialog} aria-labelledby="demand-map-viewer-title" style={{ width: "min(1200px, 96vw)", maxWidth: "96vw", maxHeight: "96vh", padding: 16, border: "1px solid #ccc", borderRadius: 8 }} onClose={() => { drag.current = null; }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <h2 id="demand-map-viewer-title" style={{ margin: 0, marginRight: "auto" }}>Demand Map</h2>
        <button type="button" aria-label="Zoom out" disabled={camera.zoom <= 1} onClick={() => changeZoom(1 / 1.5)}>−</button>
        <span aria-live="polite">{Math.round(camera.zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" disabled={camera.zoom >= 20} onClick={() => changeZoom(1.5)}>+</button>
        <button type="button" onClick={reset}>Reset view</button>
        <button type="button" onClick={() => dialog.current?.close()}>Close</button>
      </div>
      <p className="hint">Click a numbered circle for business details. Drag to move; wheel zooms toward your cursor. Pins stay the same size as you zoom. Arrow keys move the map; Escape closes. Saved imagery has limited detail.</p>
      <div ref={viewport} tabIndex={0} role="region" aria-label="Interactive Demand Map" style={{ height: "min(58vh, 700px)", overflow: "hidden", background: "#17212b", touchAction: "none", cursor: "grab", display: "flex", alignItems: "center", justifyContent: "center" }}
        onPointerDown={event => { if (event.button !== 0 || (event.target as Element).closest("button")) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY }; }}
        onPointerMove={event => { const previous = drag.current; if (!previous) return; setCamera(value => ({ ...value, x: value.x + event.clientX - previous.x, y: value.y + event.clientY - previous.y })); drag.current = { x: event.clientX, y: event.clientY }; }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={event => {
          const moves: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
          if (moves[event.key]) { event.preventDefault(); const [x, y] = moves[event.key]; setCamera(value => ({ ...value, x: value.x + x, y: value.y + y })); }
          else if (event.key === "+" || event.key === "=") { event.preventDefault(); changeZoom(1.5); }
          else if (event.key === "-") { event.preventDefault(); changeZoom(1 / 1.5); }
          else if (event.key === "0") { event.preventDefault(); reset(); }
        }}>
        <div style={{ position: "relative", width: "min(100%, 58vh)", flexShrink: 0, transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`, userSelect: "none" }}>
          <img src={data.imageBase64} alt={`Saved map of ${data.address}`} draggable={false} style={{ width: "100%", display: "block", pointerEvents: "none" }} />
          {preview.tenants.map((tenant, index) => <button key={tenant.placeId} type="button" aria-label={`Business ${index + 1}: ${tenant.name}`} aria-pressed={selectedId === tenant.placeId} title={tenant.name}
            onClick={() => setSelectedId(tenant.placeId)} style={{ position: "absolute", left: `${tenant.px.x / preview.size * 100}%`, top: `${tenant.px.y / preview.size * 100}%`, transform: `translate(-50%, -50%) scale(${1 / camera.zoom})`, width: 28, height: 28, minWidth: 28, padding: 0, borderRadius: "50%", border: selectedId === tenant.placeId ? "3px solid #ffcc66" : "2px solid white", background: `#${DEFAULT_CATEGORIES.find(c => c.label === tenant.category)?.color ?? "999999"}`, color: "white", fontSize: 12, lineHeight: 1, boxShadow: "0 1px 3px #000", zIndex: selectedId === tenant.placeId ? 2 : 1, cursor: "pointer" }}>{index + 1}</button>)}
          <span title="Subject property" style={{ position: "absolute", left: `${preview.site.x / preview.size * 100}%`, top: `${preview.site.y / preview.size * 100}%`, transform: `translate(-50%, -50%) scale(${1 / camera.zoom})`, width: 18, height: 18, borderRadius: "50%", border: "3px solid white", background: "#FF5A4E", pointerEvents: "none" }} />
        </div>
      </div>
      <div aria-live="polite" style={{ paddingTop: 10 }}>
        {selected ? <><strong>{preview.tenants.indexOf(selected) + 1}. {selected.name}</strong><p style={{ margin: "4px 0" }}>{selected.category} · {selected.distanceMi.toFixed(1)} mi from property {selected.website && <>· <a href={selected.website} target="_blank" rel="noopener noreferrer">Business website</a></>}</p>
          {colocated.length > 1 && <div>Businesses at the same mapped location: {colocated.map(t => <button type="button" key={t.placeId} onClick={() => setSelectedId(t.placeId)} style={{ margin: 3 }}>{t.name}</button>)}</div>}
          <small>Selected business location; active leasing demand and site suitability are unverified.</small></> : <p className="hint">Select a numbered circle to see the business name, category, distance and available website.</p>}
      </div>
    </dialog>
  </>;
}
