"use client";
// app/resume/page.tsx
//
// The installed app's start_url. Reopens the last route this device was on,
// or with ?deal=1 (the "Last deal opened" shortcut) the most recent deal on
// the tab it was left on. Falls back to the deals grid.

import { useEffect } from "react";
import { lastRoute, readRecent } from "@/lib/recent";

export default function ResumePage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target =
      (params.get("deal") === "1" ? readRecent()[0]?.href : lastRoute()) ?? "/deals";
    window.location.replace(target.startsWith("/resume") ? "/deals" : target);
  }, []);
  return (
    <main style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#0A2540", maxWidth: "none" }}>
      <img src="/logo-white.svg" alt="Dalfen" style={{ height: 18 }} />
    </main>
  );
}
