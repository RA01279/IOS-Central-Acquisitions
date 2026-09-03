"use client";
// components/DealCompsPanel.tsx
//
// The comps behind a deal's market leasing assumptions, and the range they
// imply. Interactive because the defaults are a starting point, not an answer:
// the radius, the age limit, the basis and the individual comps are all yours
// to argue with, and the suggested figure recomputes as you do.
//
// Every number here is derived in the browser from lib/comps/match.ts -- the
// same module the tests cover -- so what you see is what the scoring actually
// did, not a server-side summary you'd have to trust.

import { useMemo, useState } from "react";
import Link from "next/link";
import MapView, { type MapPoint } from "./MapView";
import {
  DEFAULT_WEIGHTS,
  formatUnit,
  scoreComps,
  suggestRange,
  type CompRecord,
  type CompType,
  type Subject,
  type ValueBasis,
} from "@/lib/comps/match";

const SALE_COLOR = "1E7A46";
const LEASE_COLOR = "2E6DA4";
const SUBJECT_COLOR = "FF5A4E";

const RADII = [3, 5, 10, 15, 25];
const AGES = [12, 24, 36, 60];

export default function DealCompsPanel({
  comps,
  subject,
  subjectAddress,
}: {
  comps: CompRecord[];
  subject: Subject;
  subjectAddress: string;
}) {
  const [compType, setCompType] = useState<CompType>("lease");
  const [basis, setBasis] = useState<ValueBasis>("building");
  const [radiusMiles, setRadiusMiles] = useState(10);
  // Two years by default, matching the recency falloff in match.ts -- a comp
  // whose recency score has decayed to zero shouldn't still be moving an
  // average. Widen it with the chips when evidence is thin.
  const [maxAgeMonths, setMaxAgeMonths] = useState(24);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const scored = useMemo(
    () =>
      scoreComps(comps, subject, compType, {
        basis,
        radiusMiles,
        maxAgeMonths,
        excludedIds: [...excluded],
        weights: DEFAULT_WEIGHTS,
      }),
    [comps, subject, compType, basis, radiusMiles, maxAgeMonths, excluded]
  );

  const range = useMemo(() => suggestRange(scored, compType, basis), [scored, compType, basis]);

  const eligible = scored.filter((s) => !s.excluded);
  const rows = showAll ? scored : scored.slice(0, Math.max(12, eligible.length));

  const color = compType === "sale" ? SALE_COLOR : LEASE_COLOR;

  const points: MapPoint[] = useMemo(() => {
    const out: MapPoint[] = [];
    if (subject.lat != null && subject.lng != null) {
      out.push({
        id: "__subject",
        lat: subject.lat,
        lng: subject.lng,
        color: SUBJECT_COLOR,
        title: `${subjectAddress} (this deal)`,
        emphasis: true,
      });
    }
    for (const s of scored) {
      if (s.excluded || s.comp.latitude == null || s.comp.longitude == null) continue;
      out.push({
        id: s.comp.id,
        lat: Number(s.comp.latitude),
        lng: Number(s.comp.longitude),
        // Contributing comps at full strength, eligible-but-not-counted paler,
        // so the map shows which comps the number actually rests on.
        color: s.inRange ? color : "9AA5B1",
        title: s.comp.address,
        href: `/comps/${s.comp.id}`,
        lines: [
          formatUnit(s.unitValue, compType, basis),
          [
            s.distanceMi != null ? `${s.distanceMi.toFixed(1)} mi` : null,
            s.ageMonths != null ? `${Math.round(s.ageMonths)} mo old` : null,
            s.inRange ? "in range" : "not counted",
          ]
            .filter(Boolean)
            .join(" · "),
        ],
      });
    }
    return out;
  }, [scored, subject, subjectAddress, compType, basis, color]);

  function toggle(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hasCoords = subject.lat != null && subject.lng != null;

  return (
    <section className="panel">
      <h2>
        Market evidence <span className="count">{eligible.length}</span>
      </h2>

      {!hasCoords && (
        <div className="warning">
          This property has no coordinates, so comps can&apos;t be matched by distance. Every comp
          below is scored on size, recency and coverage only — check the address on the deal.
        </div>
      )}

      <div className="filter-chips">
        <button
          type="button"
          className={compType === "lease" ? "chip chip-active" : "chip"}
          onClick={() => setCompType("lease")}
        >
          <span className="map-legend-dot" style={{ background: `#${LEASE_COLOR}` }} /> Lease comps
        </button>
        <button
          type="button"
          className={compType === "sale" ? "chip chip-active" : "chip"}
          onClick={() => setCompType("sale")}
        >
          <span className="map-legend-dot" style={{ background: `#${SALE_COLOR}` }} /> Sale comps
        </button>
      </div>

      <div className="filter-chips">
        <span className="muted" style={{ alignSelf: "center" }}>Within</span>
        {RADII.map((r) => (
          <button
            key={r}
            type="button"
            className={radiusMiles === r ? "chip chip-active" : "chip"}
            onClick={() => setRadiusMiles(r)}
          >
            {r} mi
          </button>
        ))}
        <span className="muted" style={{ alignSelf: "center", marginLeft: 8 }}>Last</span>
        {AGES.map((m) => (
          <button
            key={m}
            type="button"
            className={maxAgeMonths === m ? "chip chip-active" : "chip"}
            onClick={() => setMaxAgeMonths(m)}
          >
            {m} mo
          </button>
        ))}
        <span className="muted" style={{ alignSelf: "center", marginLeft: 8 }}>Per</span>
        <button
          type="button"
          className={basis === "building" ? "chip chip-active" : "chip"}
          onClick={() => setBasis("building")}
        >
          SF building
        </button>
        <button
          type="button"
          className={basis === "land" ? "chip chip-active" : "chip"}
          onClick={() => setBasis("land")}
        >
          SF land
        </button>
      </div>

      {/* The headline. Low/mid/high rather than a single number, because a
          single number implies a precision the evidence doesn't have. */}
      <div className="stat-grid stat-grid-3" style={{ marginTop: 4 }}>
        <div className="stat-tile">
          <span className="stat-value">{formatUnit(range.low, compType, basis)}</span>
          <span className="stat-label">Low (25th pct)</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value" style={{ color: `#${color}` }}>
            {formatUnit(range.mid, compType, basis)}
          </span>
          <span className="stat-label">
            Weighted mid · {range.count} comp{range.count === 1 ? "" : "s"}
          </span>
          {compType === "lease" && basis === "building" && range.mid !== null && (
            <span className="stat-delta">
              MLA market base rent: {range.mid.toFixed(2)} $/SF/mo
            </span>
          )}
        </div>
        <div className="stat-tile">
          <span className="stat-value">{formatUnit(range.high, compType, basis)}</span>
          <span className="stat-label">High (75th pct)</span>
        </div>
      </div>

      {range.caveats.length > 0 && (
        <div className="warning">
          <ul style={{ margin: 0 }}>
            {range.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {compType === "lease" && basis === "building" && range.mid !== null && (
        <p className="hint">
          Enter <strong>{range.mid.toFixed(2)}</strong> as the market base rent in the MLA below if
          you agree with it — it isn&apos;t written for you, since an assumption should be a
          decision rather than a default.
        </p>
      )}

      {points.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <MapView
            points={points}
            height={360}
            legend={[
              { label: "This deal", color: SUBJECT_COLOR },
              { label: `Counted (${range.count})`, color },
              { label: "Eligible, not counted", color: "9AA5B1" },
            ]}
          />
        </div>
      )}

      <div className="table-scroll" style={{ marginTop: 14 }}>
        <table className="summary-table log-table">
          <thead>
            <tr>
              <th>Use</th>
              <th>Address</th>
              <th>{compType === "sale" ? "$/SF" : "Rent"}</th>
              <th>Dist</th>
              <th>Age</th>
              <th>Bldg SF</th>
              <th>Cov.</th>
              <th>Score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={s.comp.id}
                style={{ opacity: s.excluded ? 0.45 : s.inRange ? 1 : 0.75 }}
              >
                <td>
                  <input
                    type="checkbox"
                    checked={!excluded.has(s.comp.id)}
                    onChange={() => toggle(s.comp.id)}
                    aria-label={`Include ${s.comp.address}`}
                  />
                </td>
                <td>
                  <Link href={`/comps/${s.comp.id}`}>{s.comp.address}</Link>
                  {s.comp.suite && <span className="muted"> {s.comp.suite}</span>}
                  {s.comp.submarket && <span className="muted"> · {s.comp.submarket}</span>}
                </td>
                <td>
                  {formatUnit(s.unitValue, compType, basis)}
                  {/* Base rent off a rent roll looks cheap next to a broker's
                      gross quote for no reason other than what was reported. */}
                  {compType === "lease" && s.comp.cam_psf_annual != null && (
                    <span className="muted" title="CAM, on top of base rent">
                      {" "}
                      +{(Number(s.comp.cam_psf_annual) / 12).toFixed(2)} CAM
                    </span>
                  )}
                </td>
                <td>{s.distanceMi != null ? `${s.distanceMi.toFixed(1)} mi` : "—"}</td>
                <td>
                  {s.ageMonths != null ? `${Math.round(s.ageMonths)} mo` : "—"}
                  {/* Recency is the heaviest factor in this score, so where the
                      date driving it is a guess, say so on the row. */}
                  {s.comp.date_estimated && (
                    <span
                      className="muted"
                      title="Commencement estimated from the lease expiration minus a typical term — the age, and so this comp's score, is approximate."
                    >
                      {" "}
                      est.
                    </span>
                  )}
                </td>
                <td>{s.comp.building_sf ? Math.round(Number(s.comp.building_sf)).toLocaleString() : "—"}</td>
                <td>
                  {s.comp.coverage_pct != null
                    ? `${(Number(s.comp.coverage_pct) * 100).toFixed(1)}%`
                    : "—"}
                </td>
                <td>{s.score.toFixed(2)}</td>
                <td className="muted">
                  {s.excluded ? s.excluded : s.inRange ? "counted" : "not counted"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {scored.length > rows.length && (
        <button
          type="button"
          className="secondary"
          style={{ marginTop: 10 }}
          onClick={() => setShowAll(true)}
        >
          Show all {scored.length} {compType} comps
        </button>
      )}

      <p className="hint" style={{ marginTop: 10 }}>
        Score is weighted toward <strong>recency</strong> above all — a stale comp next door is
        more misleading than a fresh one a few miles out — then distance, coverage, size and
        submarket match. Recency decays to nothing by about two years. Weights renormalise over
        whatever is known, so a comp missing a field is judged on the rest rather than penalised
        for our gaps. Only the highest-scoring comps within the filters feed the range; untick any
        you disagree with and the numbers move.
      </p>
    </section>
  );
}
