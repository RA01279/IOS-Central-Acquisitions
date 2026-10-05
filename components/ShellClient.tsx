"use client";
// components/ShellClient.tsx
//
// The interactive bits of the app shell (components/Nav.tsx): the Resume list,
// the offline/sync indicator, the phone tab bar with its "More" sheet, and the
// sign-out link. Each reads browser-only state, so each renders nothing (or a
// neutral placeholder) on the server and fills in after mount.

import { useEffect, useState } from "react";
import { CloudCheck, CloudOff, Cloud, LayoutGrid, Map as MapIcon, Presentation, Menu, X } from "lucide-react";
import { NAV_GROUPS } from "./nav-links";
import { ago, readRecent, rememberRoute, type RecentDeal } from "@/lib/recent";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export function ResumeList() {
  const [items, setItems] = useState<RecentDeal[]>([]);
  const [path, setPath] = useState("");
  useEffect(() => {
    const load = () => setItems(readRecent().slice(0, 3));
    load();
    setPath(window.location.pathname);
    rememberRoute(window.location.pathname + window.location.search);
    window.addEventListener("hopper-recent", load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("hopper-recent", load);
      window.removeEventListener("storage", load);
    };
  }, []);
  if (!items.length) return null;
  return (
    <div className="hs-group">
      <span className="hs-group-label">Resume</span>
      {items.map((r) => (
        <a key={r.id} href={r.href} className={path.startsWith(`/deals/${r.id}`) ? "hs-recent on" : "hs-recent"}>
          <span className="hs-recent-name">{r.name}</span>
          <span className="hs-recent-meta">
            {r.tab} · {ago(r.at)}
          </span>
        </a>
      ))}
    </div>
  );
}

export function SyncStatus() {
  const [online, setOnline] = useState(true);
  const [ready, setReady] = useState(false);
  const [loadedAt] = useState(() => Date.now());
  const [, tick] = useState(0);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    navigator.serviceWorker?.ready.then(() => setReady(true)).catch(() => {});
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      clearInterval(t);
    };
  }, []);
  const Icon = !online ? CloudOff : ready ? CloudCheck : Cloud;
  return (
    <div className="hs-status" role="status">
      <Icon size={16} color={online ? "#4E9FD6" : "#C9862B"} strokeWidth={1.75} />
      <span>
        {!online ? "Offline: saved copy" : ready ? "Offline ready" : "Online"}
        <small>{!online ? "Notes queue until you reconnect" : `Synced ${ago(loadedAt) === "now" ? "just now" : ago(loadedAt) + " ago"}`}</small>
      </span>
    </div>
  );
}

export function SignOutLink() {
  async function out() {
    try {
      // Cached pages hold deal data; a shared machine shouldn't keep them.
      navigator.serviceWorker?.controller?.postMessage("clear");
      await getSupabaseBrowserClient().auth.signOut();
    } finally {
      window.location.href = "/login";
    }
  }
  return (
    <button type="button" onClick={out}>
      Sign out
    </button>
  );
}

const TABS = [
  { href: "/deals", label: "Deals", key: "deals", icon: LayoutGrid },
  { href: "/map", label: "Map", key: "map", icon: MapIcon },
  { href: "/ic", label: "IC Decks", key: "ic", icon: Presentation },
];

export function MobileTabs({ active }: { active: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav className="hm-tabs hm-globaltabs" aria-label="Sections">
        {TABS.map((t) => (
          <a key={t.key} href={t.href} className={active === t.key ? "on" : ""}>
            <t.icon size={22} strokeWidth={1.75} color={active === t.key ? "#0E5AA7" : "#9AA8B5"} />
            {t.label}
          </a>
        ))}
        <button type="button" onClick={() => setOpen((v) => !v)} className={open ? "on" : ""} aria-expanded={open}>
          {open ? <X size={22} strokeWidth={1.75} color="#0E5AA7" /> : <Menu size={22} strokeWidth={1.75} color="#9AA8B5" />}
          More
        </button>
      </nav>
      <div className={open ? "hm-more open" : "hm-more"} onClick={() => setOpen(false)}>
        <div className="hm-more-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="hs-search">
            <form action="/search" method="get" className="nav-search">
              <input name="q" placeholder="Search everything…" autoComplete="off" />
            </form>
          </div>
          {NAV_GROUPS.flatMap((g) => g.links).map((l) => (
            <a key={l.key} href={l.href} className={active === l.key ? "hs-link on" : "hs-link"}>
              <l.icon size={17} strokeWidth={1.75} />
              {l.label}
            </a>
          ))}
          <span className="hs-user" style={{ gridColumn: "1 / -1", marginTop: 8 }}>
            <span className="who">
              <SignOutLink />
            </span>
          </span>
        </div>
      </div>
    </>
  );
}
