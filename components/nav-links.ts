// components/nav-links.ts
//
// Every section of the app, grouped as the sidebar shows them. Shared by the
// server sidebar (Nav.tsx) and the client mobile menu (ShellClient.tsx).

import {
  LayoutGrid,
  Map as MapIcon,
  Presentation,
  Plus,
  Gauge,
  BarChart3,
  ListChecks,
  Radar,
  Handshake,
  Target,
  FileStack,
  MapPin,
  Building2,
  Users,
  Bot,
  type LucideIcon,
} from "lucide-react";

export type NavLink = { href: string; label: string; key: string; icon: LucideIcon };

export const NAV_GROUPS: Array<{ label: string | null; links: NavLink[] }> = [
  {
    label: null,
    links: [
      { href: "/deals", label: "Deals", key: "deals", icon: LayoutGrid },
      { href: "/map", label: "Portfolio Map", key: "map", icon: MapIcon },
      { href: "/ic", label: "IC Decks", key: "ic", icon: Presentation },
      { href: "/deals/new", label: "New Deal", key: "new", icon: Plus },
    ],
  },
  {
    label: "Workflow",
    links: [
      { href: "/", label: "Home", key: "home", icon: Gauge },
      { href: "/tasks", label: "Tasks", key: "tasks", icon: ListChecks },
      { href: "/sourcing", label: "Sourcing", key: "sourcing", icon: Radar },
      { href: "/offers", label: "Offers", key: "offers", icon: Handshake },
      { href: "/targets", label: "Targets", key: "targets", icon: Target },
      { href: "/dashboard", label: "Dashboard", key: "dashboard", icon: BarChart3 },
    ],
  },
  {
    // Evidence you bring to a deal, as opposed to steps in the pipeline.
    label: "Evidence",
    links: [
      { href: "/comps", label: "Comps", key: "comps", icon: FileStack },
      { href: "/assets", label: "Our Assets", key: "assets", icon: Building2 },
      { href: "/locations", label: "Map Locations", key: "locations", icon: MapPin },
    ],
  },
  {
    label: "People & Tools",
    links: [
      { href: "/contacts", label: "Contacts", key: "contacts", icon: Users },
      { href: "/agents", label: "Agents", key: "agents", icon: Bot },
    ],
  },
];
