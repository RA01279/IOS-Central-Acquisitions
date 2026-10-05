"use client";
// Lists the deal pages the service worker has cached, so the offline page is
// a way back into what this device can show.

import { useEffect, useState } from "react";
import { readRecent, type RecentDeal } from "@/lib/recent";

export default function OfflineList() {
  const [items, setItems] = useState<RecentDeal[]>([]);
  useEffect(() => {
    (async () => {
      const recent = readRecent();
      try {
        const cache = await caches.open("hopper-pages-v1");
        const keys = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
        setItems(recent.filter((r) => keys.has(new URL(r.href, location.origin).pathname)));
      } catch {
        setItems(recent);
      }
    })();
  }, []);
  if (!items.length) return null;
  return (
    <div className="card" style={{ marginTop: 20 }}>
      <span className="overline">Saved on this device</span>
      <div className="list-rows">
        {items.map((r) => (
          <a key={r.id} href={r.href} className="list-row">
            <span className="grow">
              <b>{r.name}</b>
              <span>{r.tab}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
