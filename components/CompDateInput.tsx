"use client";
import { useState } from "react";

function QuarterInput({ value, onChange }: { value: string | null; onChange: (value: string | null, precision: string) => void }) {
  const [year, setYear] = useState(value?.slice(0, 4) ?? "");
  const [quarter, setQuarter] = useState(value ? String(Math.floor((Number(value.slice(5, 7)) - 1) / 3) + 1) : "");
  const commit = (y: string, q: string) => onChange(/^\d{4}$/.test(y) && Number(y) >= 1900 && Number(y) <= 2200 && q ? `${y}-${String((Number(q) - 1) * 3 + 1).padStart(2, "0")}-01` : null, "quarter");
  return <>
    <select aria-label="Lease quarter" value={quarter} onChange={e => { setQuarter(e.target.value); commit(year, e.target.value); }}>
      <option value="" disabled>Choose quarter</option>{[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}
    </select>
    <input aria-label="Lease year" type="number" min="1900" max="2200" value={year} onChange={e => { setYear(e.target.value); commit(e.target.value, quarter); }} />
    <small>Quarter only; exact execution date unknown.</small>
  </>;
}

/** Coarse source dates stay coarse until the reviewer explicitly changes precision. */
export default function CompDateInput({ value, precision, onChange }: {
  value: string | null; precision: string; onChange: (value: string | null, precision: string) => void;
}) {
  return <div>
    <select aria-label="Date precision" value={precision} onChange={e => onChange(null, e.target.value)}>
      <option value="day">Exact date</option><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option>
    </select>
    {precision === "quarter" ? <QuarterInput value={value} onChange={onChange} /> : <input aria-label="Transaction date" type={precision === "day" ? "date" : precision === "month" ? "month" : "number"} value={value?.slice(0, precision === "year" ? 4 : precision === "month" ? 7 : 10) ?? ""} onChange={e => onChange(e.target.value ? `${e.target.value}${precision === "year" ? "-01-01" : precision === "month" ? "-01" : ""}` : null, precision)} />}
  </div>;
}
