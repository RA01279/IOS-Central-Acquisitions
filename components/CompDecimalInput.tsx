"use client";

import { useState } from "react";

/** Keep unfinished decimals ("1.") while publishing numeric values for saving. */
export default function CompDecimalInput({ value, onChange, style }: {
  value: number | null;
  onChange: (value: number | null) => void;
  style?: React.CSSProperties;
}) {
  const [edit, setEdit] = useState<{ text: string; value: number | null } | null>(null);
  const text = edit && edit.value === value ? edit.text : String(value ?? "");
  return <input type="text" inputMode="decimal" value={text} style={style}
    onChange={event => {
      const raw = event.target.value.replace(/[$,]/g, "");
      if (!/^\d*(?:\.\d*)?$/.test(raw)) return;
      const next = raw === "" || raw === "." ? null : Number(raw);
      if (next !== null && !Number.isFinite(next)) return;
      setEdit({ text: raw, value: next });
      onChange(next);
    }} />;
}
