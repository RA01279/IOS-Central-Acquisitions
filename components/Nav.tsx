// components/Nav.tsx
//
// The app shell: navy left sidebar on desktop, a top bar + bottom tab bar on
// phones. Every page already renders <Nav active="..."/>, so the shell lives
// here and pages don't change. The sidebar is position:fixed and body gets
// its left padding from CSS (body:has(.hs)) -- see app/hopper.css.
//
// Plain <a> tags on purpose, not next/link: tab clicks do a full page load,
// which guarantees boards and the dashboard always show live data. Next's
// client router cache serves stale copies for up to 30s, which repeatedly
// confused users into thinking archives/creates hadn't worked (and led to
// duplicate deal entry). An internal tracker takes the tiny speed hit.

import NavSearch from "./NavSearch";
import { getCurrentUser } from "@/lib/auth";
import { NAV_GROUPS } from "./nav-links";
import { ResumeList, SyncStatus, MobileTabs, SignOutLink } from "./ShellClient";

// Older pages pass the keys of the old top nav.
const ALIASES: Record<string, string> = { pipeline: "deals" };

export default async function Nav({ active }: { active?: string }) {
  const user = await getCurrentUser().catch(() => null);
  const on = ALIASES[active ?? ""] ?? active ?? "";
  const email = user?.email ?? "";
  const handle = email.split("@")[0] ?? "";
  const initials = (handle.replace(/[^a-z]/gi, "").slice(0, 2) || "?").toUpperCase();

  return (
    <>
      <aside className="hs" aria-label="Hopper navigation">
        <a href="/deals" className="hs-brand">
          <img src="/logo-white.svg" alt="Dalfen" />
          <span className="eyebrow">Hopper · Acquisitions</span>
        </a>
        <div className="hs-search">
          <NavSearch />
        </div>
        {NAV_GROUPS.map((g, i) => (
          <nav key={i} className="hs-group" aria-label={g.label ?? "Main"}>
            {g.label && <span className="hs-group-label">{g.label}</span>}
            {g.links.map((l) => (
              <a key={l.key} href={l.href} className={on === l.key ? "hs-link on" : "hs-link"}>
                <l.icon size={17} strokeWidth={1.75} />
                {l.label}
              </a>
            ))}
          </nav>
        ))}
        <ResumeList />
        <div className="hs-spacer" />
        <SyncStatus />
        <div className="hs-user">
          <span className="avatar">{initials}</span>
          <span className="who">
            <span title={email}>{handle || "Signed in"}</span>
            <SignOutLink />
          </span>
        </div>
      </aside>

      <header className="hm-top">
        <a href="/deals">
          <img src="/logo-white.svg" alt="Dalfen" />
        </a>
        <span className="eyebrow">Hopper</span>
      </header>
      <MobileTabs active={on} />
    </>
  );
}
