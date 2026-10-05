"use client";
// components/DealGrid.tsx
//
// The /deals card grid: score tile, price/size/basis, the six-cell flag strip,
// stage and age. Tick "Compare" on up to four cards and a tray offers
// /deals/compare?ids=... The selection survives reloads within the tab.

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { DealCardData } from "@/lib/deal-view";
import { Badge, FlagStrip, ScoreTile, STAGE_TONES } from "./ui";

const KEY = "hopper.compare.v1";
const MAX = 4;

export default function DealGrid({ cards }: { cards: DealCardData[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
      if (Array.isArray(v)) setPicked(v.slice(0, MAX));
    } catch {}
  }, []);
  function toggle(id: string) {
    setPicked((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX ? cur : [...cur, id];
      try {
        sessionStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  function clear() {
    setPicked([]);
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
  }
  const refs = picked.map((id) => cards.find((c) => c.id === id)?.ref || id.slice(0, 8));

  return (
    <>
      <div className="deal-grid">
        {cards.map((d) => {
          const on = picked.includes(d.id);
          const full = !on && picked.length >= MAX;
          const color = on ? "#0E5AA7" : "#6B7A88";
          return (
            <div key={d.id} className={on ? "dcard picked" : "dcard"}>
              <a href={`/deals/${d.id}`} className="dcard-top">
                <span className="dcard-name">
                  <b title={d.name}>{d.name}</b>
                  <span>
                    {[d.market ?? d.city, d.typeLabel].filter(Boolean).join(" · ")}
                    {d.ref && <span className="mono" style={{ marginLeft: 6, fontSize: 11 }}>{d.ref}</span>}
                  </span>
                </span>
                <ScoreTile score={d.score} />
              </a>
              <a href={`/deals/${d.id}`} className="dcard-facts" style={{ textDecoration: "none" }}>
                <div>
                  <span>Price</span>
                  <b title={d.priceBasis}>{d.priceLabel}</b>
                </div>
                <div>
                  <span>Size</span>
                  <b>{d.sizeLabel}</b>
                </div>
                <div>
                  <span>Basis</span>
                  <b>
                    {d.basisLabel}
                    {d.basisValue != null && <small style={{ fontSize: 11, color: "#6B7A88" }}>{d.basisUnit}</small>}
                  </b>
                </div>
              </a>
              <FlagStrip flags={d.flags} />
              <div className="dcard-foot">
                <Badge tone={STAGE_TONES[d.stage] ?? "neutral"}>{d.stageLabel}</Badge>
                <span className={d.days >= 14 && d.stage !== "closed" ? "age old" : "age"}>
                  {d.stage === "closed" ? "Closed" : d.days === 0 ? "Today" : `${d.days} day${d.days === 1 ? "" : "s"} in stage`}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="cmp-toggle"
                  onClick={() => toggle(d.id)}
                  disabled={full}
                  title={full ? `Compare holds ${MAX} sites` : undefined}
                  style={{ color }}
                  aria-pressed={on}
                >
                  <span className="cmp-box" style={{ border: `1.5px solid ${color}`, background: on ? color : "#fff" }}>
                    {on && <Check size={10} color="#fff" strokeWidth={3} />}
                  </span>
                  Compare
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {picked.length > 0 && (
        <div className="cmp-tray">
          <span className="lbl">
            {picked.length} site{picked.length === 1 ? "" : "s"} selected
          </span>
          <span className="url">/deals/compare?ids={refs.join(",")}</span>
          <button type="button" className="link-caps" style={{ color: "#9EC3E5" }} onClick={clear}>
            Clear
          </button>
          <a
            href={`/deals/compare?ids=${picked.join(",")}`}
            className="btn btn-primary"
            aria-disabled={picked.length < 2}
            style={picked.length < 2 ? { opacity: 0.6, pointerEvents: "none" } : undefined}
          >
            Compare Sites
          </a>
        </div>
      )}
    </>
  );
}
