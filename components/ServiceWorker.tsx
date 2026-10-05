"use client";
// components/ServiceWorker.tsx
//
// Registers public/sw.js (production only -- a caching worker in `next dev`
// just serves yesterday's bundle) and flushes the offline notes outbox
// whenever the connection returns.

import { useEffect } from "react";
import { flushOutbox, readOutbox } from "@/lib/outbox";

export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const flush = async () => {
      if (!readOutbox().length) return;
      const sent = await flushOutbox();
      // Reload so the synced notes show up in the timeline.
      if (sent && /^\/deals\/[0-9a-f-]{36}/i.test(location.pathname)) location.reload();
    };
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, []);
  return null;
}
