"use client";
// components/DealWorkspaceClient.tsx
//
// Client pieces of the deal workspace header: the tab row (which keeps the
// demand-map state ?r=&cats= when hopping between Demand Map and IC Deck, so
// the slide matches the map), the phone back/share bar and bottom tabs, and
// the Resume tracker.

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, Share, LayoutGrid, Map as MapIcon, NotebookPen, Presentation } from "lucide-react";
import { pushRecent } from "@/lib/recent";

// The Underwriting tab (Hopper engine, sample inputs) is behind a flag until it
// runs on real deal inputs. The route 404s without it too.
const UW_ENGINE_TAB = process.env.NEXT_PUBLIC_UW_ENGINE_TAB === "1";

export const DEAL_TABS = [
  { seg: "", label: "Summary", short: "Summary", icon: LayoutGrid },
  { seg: "demand-map", label: "Demand Map", short: "Map", icon: MapIcon },
  { seg: "financials", label: "Financials", short: "Financials", icon: null },
  ...(UW_ENGINE_TAB ? [{ seg: "underwriting", label: "Underwriting", short: "UW", icon: null }] : []),
  { seg: "notes", label: "Notes & History", short: "Notes", icon: NotebookPen },
  { seg: "ic-deck", label: "IC Deck", short: "IC Deck", icon: Presentation },
] as const;

function useTab(id: string) {
  const path = usePathname() ?? "";
  const rest = path.replace(`/deals/${id}`, "").replace(/^\//, "").split("/")[0];
  return DEAL_TABS.find((t) => t.seg === rest) ?? DEAL_TABS[0];
}

/** Map state that should follow you between Demand Map and IC Deck. */
function useCarry() {
  const sp = useSearchParams();
  const keep = new URLSearchParams();
  for (const k of ["r", "cats"]) {
    const v = sp?.get(k);
    if (v) keep.set(k, v);
  }
  const s = keep.toString();
  return s ? `?${s}` : "";
}

function tabHref(id: string, seg: string, carry: string) {
  const base = `/deals/${id}${seg ? `/${seg}` : ""}`;
  return seg === "demand-map" || seg === "ic-deck" ? base + carry : base;
}

export function DealTabs({ id }: { id: string }) {
  const tab = useTab(id);
  const carry = useCarry();
  return (
    <nav className="ws-tabs" aria-label="Deal views">
      {DEAL_TABS.map((t) => (
        <a key={t.seg} href={tabHref(id, t.seg, carry)} className={t.seg === tab.seg ? "on" : ""}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}

export function DealMobileTabs({ id }: { id: string }) {
  const tab = useTab(id);
  const carry = useCarry();
  const shown = DEAL_TABS.filter((t) => t.icon);
  return (
    <nav className="hm-tabs hm-dealtabs" aria-label="Deal views">
      {shown.map((t) => {
        const on = t.seg === tab.seg;
        const Icon = t.icon!;
        return (
          <a key={t.seg} href={tabHref(id, t.seg, carry)} className={on ? "on" : ""}>
            <Icon size={22} strokeWidth={1.75} color={on ? "#0E5AA7" : "#9AA8B5"} />
            {t.short}
          </a>
        );
      })}
    </nav>
  );
}

export function DealMobileBar({ id, name }: { id: string; name: string }) {
  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: name, url });
      else {
        await navigator.clipboard.writeText(url);
        alert("Link copied");
      }
    } catch {
      /* dismissed */
    }
  }
  return (
    <div className="ph-mobile-bar">
      <a href="/deals">
        <ChevronLeft size={18} color="#A9D0EC" />
        Deals
      </a>
      <button type="button" onClick={share} aria-label="Share this view">
        <Share size={18} color="#A9D0EC" />
      </button>
    </div>
  );
}

export function TrackRecent({ id, name }: { id: string; name: string }) {
  const tab = useTab(id);
  useEffect(() => {
    pushRecent({ id, name, tab: tab.label, href: window.location.pathname + window.location.search });
  }, [id, name, tab.label]);
  return null;
}
