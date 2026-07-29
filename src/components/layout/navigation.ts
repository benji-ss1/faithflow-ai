import {
  Archive,
  BarChart3,
  BookOpen,
  Building2,
  CalendarClock,
  CreditCard,
  FolderInput,
  GalleryVerticalEnd,
  LayoutDashboard,
  LifeBuoy,
  MonitorPlay,
  MonitorSmartphone,
  Music4,
  Palette,
  PlayCircle,
  Settings,
  Sparkles,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href?: string;
  icon: LucideIcon;
  badge?: string;
  disabled?: boolean;
  children?: NavItem[];
};

export type NavGroup = {
  label: string;
  items: NavItem[];
  // When set, the group header becomes a clickable chevron toggle that
  // expands/collapses its children. Read by Sidebar.tsx and persisted per
  // user in localStorage under key `pf_sidebar_sections_v1`.
  collapsible?: boolean;
  defaultOpen?: boolean;
};

export type ActiveNavMatch = {
  group: string;
  item: NavItem;
  section: "workspace" | "account";
};

// Web nav — admin/billing/team only. The live-show surface (Services'
// operator entry, projector/setup/diagnostics, tutorials) is desktop-only
// as of the web/desktop split (see src/middleware.ts) and intentionally
// has no permanent top-level row here — reachable via the dashboard.
//
// Groups follow the 2026-07-25 visual-overhaul brief:
// WORKSPACE (day-to-day) / CONTENT (library) / PEOPLE (team) / ADMIN (settings).
export const workspaceNav: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/services", label: "Services", icon: CalendarClock },
    ],
  },
  {
    label: "Content",
    collapsible: true,
    defaultOpen: true,
    items: [
      { href: "/library/songs", label: "Songs", icon: Music4 },
      { href: "/library/bible", label: "Bible", icon: BookOpen },
      { href: "/library/media", label: "Media", icon: GalleryVerticalEnd },
      { href: "/library/imports", label: "Imports", icon: FolderInput },
      { href: "/library/themes", label: "Themes", icon: Palette },
      { href: "/archive", label: "Sermon Archive", icon: Archive },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/settings/team", label: "Team", icon: Users },
      { href: "/settings/devices", label: "Devices", icon: MonitorPlay },
    ],
  },
  {
    label: "Admin",
    collapsible: true,
    defaultOpen: false,
    items: [
      { href: "/organization", label: "Church Profile", icon: Building2 },
      { href: "/subscriptions", label: "Billing", icon: CreditCard },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

// Desktop shell sidebar — presenting-only. No admin/billing/team surfaces.
// Rendered when the Electron client is detected (window.electronAPI or the
// pf_shell=desktop cookie set by middleware).
export const desktopNav: NavGroup[] = [
  {
    label: "Content",
    items: [
      { href: "/library/songs", label: "Songs", icon: Music4 },
      { href: "/library/bible", label: "Bible", icon: BookOpen },
      { href: "/library/media", label: "Media", icon: GalleryVerticalEnd },
      { href: "/library/imports", label: "Imports", icon: FolderInput },
      { href: "/library/themes", label: "Themes", icon: Palette },
    ],
  },
  {
    label: "Learn",
    items: [
      { href: "/tutorial", label: "Guided tutorial", icon: PlayCircle },
      { href: "/help/first-sunday", label: "First Sunday playbook", icon: LifeBuoy },
      { href: "/setup/projector", label: "Projector setup", icon: MonitorSmartphone },
      { href: "/setup/audio", label: "Microphone / mixer setup", icon: Sparkles },
      { href: "/setup/diagnostics", label: "Install diagnostics", icon: Wrench },
    ],
  },
];

// accountNav is no longer rendered as a sidebar section (the items moved
// into the new WORKSPACE/PEOPLE/ADMIN groups above). It's kept here solely
// so `getActiveNavMatch` can still resolve breadcrumb/route-title lookups
// for URL-reachable account pages. /applications and /products intentionally
// stay off this list: they were orphaned by the rebuild and route-title
// resolution shouldn't describe pages the user can't reach from any nav.
export const accountNav: NavGroup[] = [
  {
    label: "Account",
    items: [
      { href: "/organization", label: "Organization", icon: Building2 },
      { href: "/subscriptions", label: "Subscriptions", icon: CreditCard },
      { href: "/settings/billing", label: "Billing", icon: CreditCard },
      { href: "/profile", label: "My Profile", icon: Sparkles },
    ],
  },
];

const routeTitleMap: Array<{ match: RegExp; title: string; subtitle: string }> = [
  { match: /^\/dashboard/, title: "Overview", subtitle: "Church-wide readiness, content health, and admin signals." },
  { match: /^\/services/, title: "Services", subtitle: "Schedule, prep, and launch service plans without entering the live console." },
  { match: /^\/library\/songs/, title: "Songs", subtitle: "Library, licensing metadata, and import state for worship content." },
  { match: /^\/library\/bible/, title: "Bible Library", subtitle: "Public-domain translations now, licensed providers later." },
  { match: /^\/library\/media/, title: "Media Library", subtitle: "Manage stills, videos, and supporting presentation assets." },
  { match: /^\/library\/imports/, title: "Imports & Migration", subtitle: "Review queued imports and migration cleanup work." },
  { match: /^\/archive/, title: "Sermon Archive", subtitle: "Browse summaries, exports, and archive history." },
  { match: /^\/analytics/, title: "Analytics", subtitle: "Attendance, engagement, and content signals across services." },
  { match: /^\/library\/themes/, title: "Themes", subtitle: "Presentation themes, colour palettes, and slide styling." },
  { match: /^\/applications/, title: "Applications", subtitle: "PresentFlow modules, status, and future product surfaces." },
  { match: /^\/organization/, title: "Church Profile", subtitle: "Identity, worship defaults, and organization details." },
  { match: /^\/settings\/team/, title: "Team", subtitle: "Members, invitations, and role ownership." },
  { match: /^\/settings\/billing/, title: "Billing", subtitle: "Payment health, invoices, and account ownership." },
  { match: /^\/subscriptions/, title: "Subscriptions", subtitle: "Plan status, usage, and renewal posture." },
  { match: /^\/profile/, title: "My Profile", subtitle: "Account details, security, and personal preferences." },
  { match: /^\/products/, title: "Get More Products", subtitle: "Future marketplace and expansion surfaces." },
  { match: /^\/settings/, title: "Settings", subtitle: "General app defaults and connected system preferences." },
];

export function getRouteMeta(pathname: string) {
  return (
    routeTitleMap.find((item) => item.match.test(pathname)) ?? {
      title: "PresentFlow",
      subtitle: "Calm, premium controls for the broader account and dashboard workspace.",
    }
  );
}

export function getActiveNavMatch(pathname: string): ActiveNavMatch | null {
  const sources: Array<{ section: "workspace" | "account"; groups: NavGroup[] }> = [
    { section: "workspace", groups: workspaceNav },
    { section: "account", groups: accountNav },
  ];

  for (const source of sources) {
    for (const group of source.groups) {
      for (const item of group.items) {
        if (item.href && (pathname === item.href || pathname.startsWith(item.href + "/"))) {
          return { group: group.label, item, section: source.section };
        }
        if (item.children) {
          for (const child of item.children) {
            if (child.href && (pathname === child.href || pathname.startsWith(child.href + "/"))) {
              return { group: group.label, item: child, section: source.section };
            }
          }
        }
      }
    }
  }

  return null;
}
