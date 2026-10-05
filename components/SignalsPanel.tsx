"use client";
// components/SignalsPanel.tsx
//
// "Site viability flags" on the deal summary. Tap a flag to see where it came
// from and when, and to override it (an override needs a reason -- it prints
// on the IC slide). Refresh recomputes every automatic flag; "re-run demand"
// also repeats the Google Places search, which costs money, so it's separate.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { signal, hex } from "@/lib/hopper-tokens";
import type { Flag } from "@/lib/site-score";
import { FlagCellBody } from "./ui";

export default function SignalsPanel({
  dealId,
  flags,
  refreshedAt,
  compact,
}: {
  dealId: string;
  flags: Flag[];
  refreshedAt: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Flag | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const assessed = flags.some((f) => f.at);

  async function post(body: object, label: string) {
    setBusy(label);
    setError("");
    try {
      const res = await fetch(`/api/deals/${dealId}/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      if (json.errors?.length) setError(`Some checks failed: ${json.errors.join("; ")}`);
      setOpen(null);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="overline">Site viability flags</span>
        <span style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
          {!compact && <span className="hint" style={{ margin: 0, fontSize: 11 }}>Tap a flag for its source</span>}
          <button type="button" className="link-caps" onClick={() => post({ action: "refresh" }, "refresh")} disabled={!!busy}>
            <RefreshCw size={11} style={{ verticalAlign: -1, marginRight: 4 }} className={busy === "refresh" ? "spin" : ""} />
            {busy === "refresh" ? "Checking…" : assessed ? "Refresh" : "Score this site"}
          </button>
        </span>
      </div>
      <div className={compact ? "flag-grid mobile-chips" : "flag-grid mobile-chips"}>
        {flags.map((f) => (
          <button
            key={f.key}
            type="button"
            className="flag-cell"
            style={{ background: hex(signal[f.state].bg) }}
            onClick={() => {
              setOpen(f);
              setNote(f.overridden ? f.note : "");
              setError("");
            }}
          >
            <FlagCellBody flag={f} />
          </button>
        ))}
      </div>
      {refreshedAt && (
        <span className="hint" style={{ margin: 0, fontSize: 11 }}>
          Checked {new Date(refreshedAt).toLocaleString()} · FEMA, OpenStreetMap, municipal GIS, comps, Google Places
        </span>
      )}
      {error && !open && <p className="error" style={{ margin: 0 }}>{error}</p>}

      {open && (
        <div className="flag-pop" onClick={() => setOpen(null)}>
          <div className="flag-pop-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${open.label} flag`}>
            <span className="overline-muted">Site viability flag</span>
            <h3>{open.label}</h3>
            <div className="flag-cell" style={{ background: hex(signal[open.state].bg), cursor: "default" }}>
              <FlagCellBody flag={open} />
            </div>
            <p className="hint" style={{ margin: 0 }}>
              <strong>Source:</strong> {open.source ?? "Not assessed yet"}
              {open.at && <> · {new Date(open.at).toLocaleString()}</>}
            </p>
            {open.overridden && (
              <p className="hint" style={{ margin: 0 }}>
                Hopper&apos;s own reading: <strong>{signal[open.autoState].label}</strong>
                {open.autoNote ? ` — ${open.autoNote}` : ""}
              </p>
            )}
            <label className="overline-muted" htmlFor="ovr-note" style={{ marginTop: 4 }}>
              Override with a reason
            </label>
            <textarea
              id="ovr-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={
                open.key === "zoning" ? "e.g. City planner confirmed outdoor storage is permitted by right in IM" : "What you know that Hopper doesn't"
              }
              style={{ font: "inherit", fontSize: 13, padding: 8, border: "1px solid #C4CFD9", borderRadius: 3 }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["strong", "watch", "weak"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!!busy}
                  onClick={() => post({ action: "override", key: open.key, state: s, note }, s)}
                  style={{ background: hex(signal[s].fg) }}
                >
                  {busy === s ? "Saving…" : `Mark ${signal[s].label}`}
                </button>
              ))}
              {open.overridden && (
                <button
                  type="button"
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => post({ action: "override", key: open.key, state: null }, "clear")}
                >
                  Use Hopper&apos;s reading
                </button>
              )}
              {open.key === "demand" && (
                <button
                  type="button"
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => post({ action: "refresh", demand: true }, "demand")}
                >
                  {busy === "demand" ? "Searching…" : "Re-run demand search"}
                </button>
              )}
            </div>
            {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
