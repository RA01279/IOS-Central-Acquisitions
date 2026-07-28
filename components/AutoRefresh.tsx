"use client";
// components/AutoRefresh.tsx
//
// Invisible helper: when the user returns to a tab that's been sitting idle,
// reload the page so boards and the dashboard always show current data. A
// long-lived open tab was repeatedly mistaken for "the tracker is broken" --
// this makes stale tabs self-heal.

import { useEffect } from "react";

export default function AutoRefresh({ minAgeMs = 15000 }: { minAgeMs?: number }) {
  useEffect(() => {
    const loadedAt = Date.now();
    // The moment the user types into ANY form on the page, auto-refresh
    // stands down -- reloading would wipe their input. (Bug: switching away
    // to copy something and coming back used to reload mid-entry.)
    let dirty = false;
    const markDirty = () => {
      dirty = true;
    };
    function maybeReload() {
      if (!dirty && document.visibilityState === "visible" && Date.now() - loadedAt > minAgeMs) {
        window.location.reload();
      }
    }
    document.addEventListener("input", markDirty, true);
    document.addEventListener("visibilitychange", maybeReload);
    window.addEventListener("focus", maybeReload);
    return () => {
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("visibilitychange", maybeReload);
      window.removeEventListener("focus", maybeReload);
    };
  }, [minAgeMs]);
  return null;
}
