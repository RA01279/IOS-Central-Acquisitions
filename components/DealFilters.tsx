"use client";
// components/DealFilters.tsx
//
// The /deals filter bar: Pipeline, Market (multi), Stage (multi), Sort, and
// search -- one row of dropdown pills with counts, then the active filters as
// removable chips with "Clear all". Everything is written to the URL
// (?market=Houston,DFW&stage=prospect,uw&sort=oldest) so a link reproduces
// the exact view.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Search, X } from "lucide-react";

export type Option = { value: string; label: string; count?: number };

export interface FilterState {
  asset: string;
  markets: string[];
  stages: string[];
  sort: string;
  view: string;
  q: string;
}

export const DEFAULTS = { asset: "ios", sort: "newest", view: "cards" };

export function filterHref(s: FilterState): string {
  const p = new URLSearchParams();
  if (s.asset !== DEFAULTS.asset) p.set("asset", s.asset);
  if (s.markets.length) p.set("market", s.markets.join(","));
  if (s.stages.length) p.set("stage", s.stages.join(","));
  if (s.sort !== DEFAULTS.sort) p.set("sort", s.sort);
  if (s.view !== DEFAULTS.view) p.set("view", s.view);
  if (s.q) p.set("q", s.q);
  const qs = p.toString();
  return `/deals${qs ? `?${qs}` : ""}`;
}

function Pill({
  label,
  value,
  active,
  children,
}: {
  label: string;
  value: string;
  active: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="fpill-wrap" ref={ref}>
      <button type="button" className={active ? "fpill on" : "fpill"} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="fpill-label">{label}:</span> {value}
        <ChevronDown size={14} />
      </button>
      {open && <div className="fmenu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

export default function DealFilters({
  state,
  pipelines,
  markets,
  stages,
  sorts,
  shown,
  total,
}: {
  state: FilterState;
  pipelines: Option[];
  markets: Option[];
  stages: Option[];
  sorts: Option[];
  shown: number;
  total: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState(state.q);
  const go = (patch: Partial<FilterState>) => router.push(filterHref({ ...state, ...patch }), { scroll: false });
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const labelOf = (opts: Option[], v: string) => opts.find((o) => o.value === v)?.label ?? v;
  const summary = (picked: string[], opts: Option[], none: string) =>
    picked.length === 0 ? none : picked.length === 1 ? labelOf(opts, picked[0]) : `${picked.length} selected`;

  const multi = (opts: Option[], picked: string[], key: "markets" | "stages") => (
    <>
      <div className="fmenu-list">
        {opts.map((o) => {
          const on = picked.includes(o.value);
          return (
            <button key={o.value} type="button" className="fmenu-item" onClick={() => go({ [key]: toggle(picked, o.value) } as any)}>
              <span className={on ? "fbox on" : "fbox"}>{on && <Check size={11} color="#fff" strokeWidth={3} />}</span>
              <span className="grow">{o.label}</span>
              {o.count != null && <span className="fcount">{o.count}</span>}
            </button>
          );
        })}
      </div>
      {picked.length > 0 && (
        <button type="button" className="fmenu-clear" onClick={() => go({ [key]: [] } as any)}>
          Clear
        </button>
      )}
    </>
  );

  const single = (opts: Option[], current: string, key: "asset" | "sort") => (close: () => void) => (
    <div className="fmenu-list">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          className="fmenu-item"
          onClick={() => {
            close();
            go({ [key]: o.value } as any);
          }}
        >
          <span className="fradio">{current === o.value && <Check size={14} color="#0E5AA7" strokeWidth={2.5} />}</span>
          <span className="grow">{o.label}</span>
          {o.count != null && <span className="fcount">{o.count}</span>}
        </button>
      ))}
    </div>
  );

  const chips = [
    ...state.markets.map((m) => ({ key: `m-${m}`, label: labelOf(markets, m), remove: () => go({ markets: state.markets.filter((x) => x !== m) }) })),
    ...state.stages.map((s) => ({ key: `s-${s}`, label: labelOf(stages, s), remove: () => go({ stages: state.stages.filter((x) => x !== s) }) })),
    ...(state.q ? [{ key: "q", label: `"${state.q}"`, remove: () => { setQ(""); go({ q: "" }); } }] : []),
  ];

  return (
    <div className="fbar">
      <div className="fbar-row">
        <Pill label="Pipeline" value={labelOf(pipelines, state.asset)} active={state.asset !== DEFAULTS.asset}>
          {single(pipelines, state.asset, "asset")}
        </Pill>
        <Pill label="Market" value={summary(state.markets, markets, "All")} active={state.markets.length > 0}>
          {() => multi(markets, state.markets, "markets")}
        </Pill>
        <Pill label="Stage" value={summary(state.stages, stages, "All")} active={state.stages.length > 0}>
          {() => multi(stages, state.stages, "stages")}
        </Pill>
        <Pill label="Sort" value={labelOf(sorts, state.sort)} active={false}>
          {single(sorts, state.sort, "sort")}
        </Pill>
        <span style={{ flex: 1 }} />
        <form
          className="tsearch"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: q.trim() });
          }}
        >
          <Search size={15} color="#9AA8B5" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address, city, D-#" aria-label="Search deals" />
        </form>
        <a href={filterHref({ ...state, view: state.view === "cards" ? "board" : "cards" })} className="tchip">
          {state.view === "cards" ? "Board view" : "Card view"}
        </a>
      </div>
      <div className="fbar-row fbar-active">
        <span className="fresult">
          {shown === total ? `${total} deal${total === 1 ? "" : "s"}` : `${shown} of ${total} deals`}
        </span>
        {chips.map((c) => (
          <button key={c.key} type="button" className="fchip" onClick={c.remove} aria-label={`Remove ${c.label}`}>
            {c.label}
            <X size={12} />
          </button>
        ))}
        {chips.length > 0 && (
          <button type="button" className="link-caps" onClick={() => { setQ(""); go({ markets: [], stages: [], q: "" }); }}>
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
