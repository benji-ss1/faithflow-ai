import {
  Archive,
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  CreditCard,
  FolderInput,
  GalleryVerticalEnd,
  LayoutDashboard,
  LifeBuoy,
  Library,
  MonitorSmartphone,
  Music4,
  Palette,
  PlayCircle,
  Presentation,
  Settings,
  Sparkles,
  Users,
  Workflow,
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
};

export type ActiveNavMatch = {
  group: string;
  item: NavItem;
  section: "workspace" | "account";
};

export const workspaceNav: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/services", label: "Services", icon: Presentation },
      { label: "Operator", icon: MonitorSmartphone, badge: "Live", disabled: true },
    ],
  },
  {
    label: "Content",
    items: [
      {
        label: "Library",
        icon: Library,
        children: [
          { href: "/library/songs", label: "Songs", icon: Music4 },
          { href: "/library/bible", label: "Bible", icon: BookOpen },
          { href: "/library/media", label: "Media", icon: GalleryVerticalEnd },
          { href: "/library/imports", label: "Imports", icon: FolderInput },
          { href: "/library/themes", label: "Themes", icon: Palette },
        ],
      },
      { href: "/archive", label: "Sermon Archive", icon: Archive },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { label: "AI Assistant", icon: Bot, badge: "Soon", disabled: true },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/organization", label: "Church Profile", icon: Building2 },
      { href: "/settings/team", label: "Team", icon: Users },
      { href: "/settings/devices", label: "Devices & Outputs", icon: Workflow },
      { href: "/subscriptions", label: "Billing", icon: CreditCard },
      { href: "/settings", label: "Settings", icon: Settings },
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

export const accountNav: NavGroup[] = [
  {
    label: "Account",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/organization", label: "Organization", icon: Building2 },
      { href: "/applications", label: "Applications", icon: Library },
      { href: "/subscriptions", label: "Subscriptions", icon: CreditCard },
      { href: "/settings/billing", label: "Billing", icon: CreditCard },
      { href: "/profile", label: "My Profile", icon: Sparkles },
      { href: "/products", label: "Get More Products", icon: Sparkles },
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
