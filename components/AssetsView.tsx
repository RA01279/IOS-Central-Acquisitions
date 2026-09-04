"use client";
// components/AssetsView.tsx
//
// The portfolio map and table, with a market filter and inline editing for the
// figures the source page doesn't publish.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MapView, { type MapPoint } from "./MapView";

const OCCUPIED_COLOR = "6C4AB6";
const AVAILABLE_COLOR = "C77DFF";
const SOLD_COLOR = "9AA5B1";

export interface AssetDetail {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  market: string | null;
  submarket: string | null;
  asset_class: string;
  status: string;
  occupancy: string | null;
  site_acres: number | null;
  building_sf: number | null;
  latitude: number | null;
  longitude: number | null;
  geocode_precision: string | null;
  notes: string | null;
  source_url: string | null;
}

function colorFor(a: AssetDetail): string {
  if (a.status === "sold") return SOLD_COLOR;
  return a.occupancy === "available" ? AVAILABLE_COLOR : OCCUPIED_COLOR;
}

export default function AssetsView({ assets }: { assets: AssetDetail[] }) {
  const router = useRouter();
  const [market, setMarket] = useState("__all");
  const [includeSold, setIncludeSold] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<{ acres: string; sf: string; submarket: string; notes: string }>(
    { acres: "", sf: "", submarket: "", notes: "" }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markets = useMemo(
    () => Array.from(new Set(assets.map((a) => a.market).filter(Boolean) as string[])).sort(),
    [assets]
  );

  const shown = useMemo(
    () =>
      assets
        .filter((a) => includeSold || a.status !== "sold")
        .filter((a) => market === "__all" || a.market === market),
    [assets, includeSold, market]
  );

  const points: MapPoint[] = useMemo(
    () =>
      shown
        .filter((a) => a.latitude != null && a.longitude != null)
        .map((a) => ({
          id: a.id,
          lat: Number(a.latitude),
          lng: Number(a.longitude),
          color: colorFor(a),
          title: a.address,
          lines: [
            [a.city, a.state].filter(Boolean).join(", "),
            [
              a.status === "sold" ? "SOLD" : a.occupancy === "available" ? "Space available" : "Occupied",
              a.site_acres ? `${a.site_acres} AC` : null,
              a.building_sf ? `${Math.round(Number(a.building_sf)).toLocaleString()} SF` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          ].filter((l) => l.length > 0),
        })),
    [shown]
  );

  function startEdit(a: AssetDetail) {
    setEditing(a.id);
    setError(null);
    setForm({
      acres: a.site_acres == null ? "" : String(a.site_acres),
      sf: a.building_sf == null ? "" : String(a.building_sf),
      submarket: a.submarket ?? "",
      notes: a.notes ?? "",
    });
  }

  async function save(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteAcres: form.acres,
          buildingSf: form.sf,
          submarket: form.submarket,
          notes: form.notes,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save");
      setEditing(null);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="panel">
        <h2>
          Portfolio map <span className="count">{points.length}</span>
        </h2>

        <div className="filter-chips">
          <button
            type="button"
            className={market === "__all" ? "chip chip-active" : "chip"}
            onClick={() => setMarket("__all")}
          >
            All markets
          </button>
          {markets.map((m) => (
            <button
              key={m}
              type="button"
              className={market === m ? "chip chip-active" : "chip"}
              onClick={() => setMarket(m)}
            >
              {m}{" "}
              <span className="muted">
                {assets.filter((a) => a.market === m && (includeSold || a.status !== "sold")).length}
              </span>
            </button>
          ))}
          <button
            type="button"
            className={includeSold ? "chip chip-active" : "chip"}
            onClick={() => setIncludeSold((v) => !v)}
          >
            Include sold
          </button>
        </div>

        <MapView
          points={points}
          height={460}
          emptyMessage="No assets to show. Run scripts/seed-assets.mjs to load the portfolio."
          legend={[
            { label: "Occupied", color: OCCUPIED_COLOR },
            { label: "Space available", color: AVAILABLE_COLOR },
            ...(includeSold ? [{ label: "Sold", color: SOLD_COLOR }] : []),
          ]}
        />
      </section>

      <section className="panel">
        <h2>
          Assets <span className="count">{shown.length}</span>
        </h2>
        {error && <p className="error">{error}</p>}
        <div className="table-scroll">
          <table className="summary-table log-table">
            <thead>
              <tr>
                <th>Address</th>
                <th>City</th>
                <th>Market</th>
                <th>Submarket</th>
                <th>Acres</th>
                <th>Bldg SF</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                // id on the row so a map popup or a deal panel can link
                // straight to it with /assets#<id>.
                <tr key={a.id} id={a.id} style={{ opacity: a.status === "sold" ? 0.55 : 1 }}>
                  <td>
                    {a.address}
                    {a.latitude == null && (
                      <span className="muted" title="No coordinates, so it can't be mapped or measured">
                        {" "}
                        · not located
                      </span>
                    )}
                  </td>
                  <td className="muted">{[a.city, a.state].filter(Boolean).join(", ") || "—"}</td>
                  <td className="muted">{a.market ?? "—"}</td>
                  <td>
                    {editing === a.id ? (
                      <input
                        value={form.submarket}
                        onChange={(e) => setForm((f) => ({ ...f, submarket: e.target.value }))}
                        style={{ width: 130 }}
                      />
                    ) : (
                      <span className="muted">{a.submarket ?? "—"}</span>
                    )}
                  </td>
                  <td>
                    {editing === a.id ? (
                      <input
                        value={form.acres}
                        onChange={(e) => setForm((f) => ({ ...f, acres: e.target.value }))}
                        placeholder="6.19"
                        style={{ width: 80 }}
                      />
                    ) : (
                      a.site_acres ?? <span className="overdue">—</span>
                    )}
                  </td>
                  <td>
                    {editing === a.id ? (
                      <input
                        value={form.sf}
                        onChange={(e) => setForm((f) => ({ ...f, sf: e.target.value }))}
                        placeholder="20200"
                        style={{ width: 90 }}
                      />
                    ) : a.building_sf ? (
                      Math.round(Number(a.building_sf)).toLocaleString()
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="muted">
                    {a.status === "sold"
                      ? "sold"
                      : a.occupancy === "available"
                        ? "space available"
                        : "occupied"}
                  </td>
                  <td>
                    {editing === a.id ? (
                      <>
                        <button onClick={() => save(a.id)} disabled={busy}>
                          {busy ? "…" : "Save"}
                        </button>{" "}
                        <button type="button" className="secondary" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" className="secondary" onClick={() => startEdit(a)}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Seeded from{" "}
          <a href="https://www.dalfen.com/ios/" target="_blank" rel="noreferrer">
            dalfen.com/ios
          </a>
          , which publishes addresses and occupancy but no acreage or building size. Re-running the
          seed updates occupancy and status and leaves anything entered here alone.
        </p>
      </section>
    </>
  );
}
