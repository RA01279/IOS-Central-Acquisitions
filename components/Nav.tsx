// components/Nav.tsx
//
// Shared top nav across the app's main sections. Server component -- it just
// renders links plus the (client) sign-out button. Pass `active` so the
// current section can be highlighted.

import Link from "next/link";
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
        <Link href="/deals">Hopper</Link>
      </div>
      <div className="app-nav-links">
        {LINKS.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            className={active === l.key ? "nav-link active" : "nav-link"}
          >
            {l.label}
          </Link>
        ))}
      </div>
      <div className="app-nav-actions">
        <SignOutButton />
      </div>
    </nav>
  );
}
