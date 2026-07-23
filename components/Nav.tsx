// components/Nav.tsx
//
// Shared top nav across the app's main sections. Server component -- it just
// renders links plus the (client) sign-out button. Pass `active` so the
// current section can be highlighted.
//
// Plain <a> tags on purpose, not next/link: tab clicks do a full page load,
// which guarantees boards and the dashboard always show live data. Next's
// client router cache serves stale copies for up to 30s, which repeatedly
// confused users into thinking archives/creates hadn't worked (and led to
// duplicate deal entry). An internal tracker takes the tiny speed hit.

import SignOutButton from "./SignOutButton";

const LINKS = [
  { href: "/deals", label: "Acquisitions", key: "acquisitions" },
  { href: "/leasing", label: "Leasing", key: "leasing" },
  { href: "/contacts", label: "Contacts", key: "contacts" },
  { href: "/tasks", label: "Tasks", key: "tasks" },
  { href: "/dashboard", label: "Dashboard", key: "dashboard" },
];

export default function Nav({ active }: { active?: string }) {
  return (
    <nav className="app-nav">
      <div className="app-nav-brand">
        <a href="/deals">Hopper</a>
      </div>
      <div className="app-nav-links">
        {LINKS.map((l) => (
          <a
            key={l.key}
            href={l.href}
            className={active === l.key ? "nav-link active" : "nav-link"}
          >
            {l.label}
          </a>
        ))}
      </div>
      <div className="app-nav-actions">
        <SignOutButton />
      </div>
    </nav>
  );
}
