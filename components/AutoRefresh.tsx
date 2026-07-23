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
    function maybeReload() {
      if (document.visibilityState === "visible" && Date.now() - loadedAt > minAgeMs) {
        window.location.reload();
      }
    }
    document.addEventListener("visibilitychange", maybeReload);
    window.addEventListener("focus", maybeReload);
    return () => {
      document.removeEventListener("visibilitychange", maybeReload);
      window.removeEventListener("focus", maybeReload);
    };
  }, [minAgeMs]);
  return null;
}
