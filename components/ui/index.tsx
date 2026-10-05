// components/ui/index.tsx
//
// The redesign's shared pieces: KpiCard, ScoreTile, FlagCell / FlagChip /
// FlagStrip, DemandBars, Badge. Server-safe (no hooks) so server pages can use
// them directly. Colours come from lib/hopper-tokens -- the same file the .pptx
// slide builder reads, so the slide always matches the screen.

import {
  Truck,
  Forklift,
  HardHat,
  BrickWall,
  Container,
  CarFront,
  Cylinder,
  Gem,
  Sprout,
  Recycle,
  type LucideIcon,
} from "lucide-react";
import { hex, scoreState, signal, type SignalState } from "@/lib/hopper-tokens";
import type { CategoryRow, Flag } from "@/lib/site-score";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  truck: Truck,
  equip: Forklift,
  constr: HardHat,
  bldg: BrickWall,
  contain: Container,
  rv: CarFront,
  steel: Cylinder,
  stone: Gem,
  land: Sprout,
  waste: Recycle,
};

export function CategoryIcon({ k, size = 16, color = "#5E7A93" }: { k: string; size?: number; color?: string }) {
  const I = CATEGORY_ICONS[k] ?? Truck;
  return <I size={size} color={color} strokeWidth={1.75} style={{ flex: "none" }} />;
}

export function KpiCard({
  label,
  value,
  unit,
  sub,
  subTone,
  title,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  subTone?: SignalState;
  title?: string;
}) {
  return (
    <div className="kpi" title={title}>
      <span className="k-label">{label}</span>
      <span className="k-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {sub != null && <span className={`k-sub ${subTone && subTone !== "unknown" ? subTone : ""}`}>{sub}</span>}
    </div>
  );
}

export function DarkKpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="kpi-dark">
      <span className="k-label">{label}</span>
      <span className="k-value">{value}</span>
      {sub != null && <span className="k-sub">{sub}</span>}
    </div>
  );
}

const SCORE_WORD: Record<SignalState, string> = { strong: "Strong", watch: "Watch", weak: "Weak", unknown: "Open" };

/** Score tile. `caption` defaults to SCORE (sm) or the band word (md/lg). */
export function ScoreTile({
  score,
  size = "sm",
  caption,
}: {
  score: number | null;
  size?: "sm" | "md" | "lg";
  caption?: string;
}) {
  const s = signal[scoreState(score)];
  return (
    <div
      className={`score ${size === "sm" ? "" : size}`}
      style={{ background: hex(s.bg), color: hex(s.fg) }}
      title={score == null ? "Not enough flags assessed to score this site yet" : `Site score ${score}`}
    >
      <b>{score ?? "—"}</b>
      <span>{caption ?? (size === "sm" ? "Score" : SCORE_WORD[scoreState(score)])}</span>
    </div>
  );
}

export function FlagStrip({ flags }: { flags: Flag[] }) {
  return (
    <div className="flag-strip" aria-label="Site viability flags">
      {flags.map((f) => {
        const s = signal[f.state];
        return (
          <div key={f.key} style={{ background: hex(s.bg), color: hex(s.fg) }} title={`${f.label}: ${s.label} — ${f.note}`}>
            {f.short}
          </div>
        );
      })}
    </div>
  );
}

export function FlagChip({ flag }: { flag: Flag }) {
  const s = signal[flag.state];
  return (
    <div className="flag-chip" style={{ background: hex(s.bg) }} title={flag.note}>
      <i style={{ background: hex(s.fg) }} />
      <span>{flag.label}</span>
    </div>
  );
}

/** Full flag cell body. Wrapped by FlagGrid (client) to make it clickable. */
export function FlagCellBody({ flag }: { flag: Flag }) {
  const s = signal[flag.state];
  return (
    <>
      <span className="bar" style={{ background: hex(s.fg) }} />
      <span className="body">
        <span className="ttl">
          <b>{flag.label}</b>
          <em style={{ color: hex(s.fg) }}>
            {s.label}
            {flag.overridden ? " · set" : ""}
          </em>
        </span>
        <span className="note">{flag.note}</span>
      </span>
    </>
  );
}

export function DemandBars({ rows, active, limit }: { rows: CategoryRow[]; active?: string[] | null; limit?: number }) {
  const on = new Set(active ?? rows.map((r) => r.key));
  const shown = [...rows].sort((a, b) => b.count - a.count).slice(0, limit ?? rows.length);
  return (
    <>
      {shown.map((r) => (
        <div key={r.key} className="dbar" style={{ opacity: on.has(r.key) ? 1 : 0.4 }}>
          <CategoryIcon k={r.key} />
          <span className="nm">{r.label}</span>
          <div className="tr">
            <div style={{ width: `${Math.round(r.share * 100)}%`, background: hex(signal[r.state].fg) }} />
          </div>
          <span className="ct">{r.count}</span>
        </div>
      ))}
    </>
  );
}

export type BadgeTone = "neutral" | "brand" | "warning" | "success" | "danger";

export const STAGE_TONES: Record<string, BadgeTone> = {
  prospect: "neutral",
  uw: "brand",
  offered: "warning",
  moving_to_psa: "warning",
  due_diligence: "success",
  closed: "success",
  archived: "neutral",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return <span className={`badge2 ${tone}`}>{children}</span>;
}
