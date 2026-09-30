/**
 * Role-based navigation — the single place to change menus.
 * Navigation is convenience only; access is enforced by RLS + server checks.
 */
import type { Role } from "@/types/domain";

export type NavIcon =
  | "dashboard" | "pipeline" | "calendar" | "customers" | "policies" | "employees" | "payroll"
  | "reports" | "export" | "settings" | "new" | "followups" | "appointments" | "production" | "earnings" | "profile" | "leads" | "trash" | "renewals";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Show a live counter badge (key into NavCounts). */
  badge?: "followups" | "pendingResults" | "leadsDue" | "expiriesDue";
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

const AGENT_WORK: NavItem[] = [
  { href: "/dashboard", label: "Nadzorna plošča", icon: "dashboard" },
  { href: "/pipeline", label: "Pipeline", icon: "pipeline", badge: "pendingResults" },
  { href: "/calendar", label: "Koledar", icon: "calendar" },
  { href: "/customers", label: "Stranke", icon: "customers" },
  { href: "/renewals", label: "Skadence", icon: "renewals", badge: "expiriesDue" },
  { href: "/policies", label: "Police", icon: "policies" },
];

export const NAVIGATION: Record<Role, NavSection[]> = {
  owner: [
    { items: AGENT_WORK },
    {
      title: "Uprava",
      items: [
        { href: "/appointments/new", label: "Nov termin", icon: "new" },
        { href: "/leads", label: "Klicni seznami", icon: "leads" },
        { href: "/follow-ups", label: "Klici nazaj", icon: "followups", badge: "followups" },
        { href: "/employees", label: "Zaposleni", icon: "employees" },
        { href: "/payroll", label: "Provizije in izplačila", icon: "payroll" },
        { href: "/reports", label: "Poročila", icon: "reports" },
        { href: "/export", label: "Uvoz / izvoz", icon: "export" },
        { href: "/deleted", label: "Storno in izbrisi", icon: "trash" },
        { href: "/settings", label: "Nastavitve", icon: "settings" },
      ],
    },
    {
      title: "Moje",
      items: [
        { href: "/production", label: "Moja produkcija", icon: "production" },
        { href: "/earnings", label: "Moji zaslužki", icon: "earnings" },
      ],
    },
  ],
  agent: [
    { items: AGENT_WORK },
    {
      title: "Moje",
      items: [
        { href: "/production", label: "Moja produkcija", icon: "production" },
        { href: "/earnings", label: "Moji zaslužki", icon: "earnings" },
        { href: "/profile", label: "Profil", icon: "profile" },
      ],
    },
  ],
  caller: [
    {
      items: [
        { href: "/dashboard", label: "Nadzorna plošča", icon: "dashboard" },
        { href: "/leads", label: "Klicni seznam", icon: "leads", badge: "leadsDue" },
        { href: "/appointments/new", label: "Nov termin", icon: "new" },
        { href: "/customers", label: "Moje stranke", icon: "customers" },
        { href: "/follow-ups", label: "Klici nazaj", icon: "followups", badge: "followups" },
        { href: "/appointments", label: "Termini", icon: "appointments" },
      ],
    },
    {
      title: "Moje",
      items: [
        { href: "/production", label: "Moja produkcija", icon: "production" },
        { href: "/earnings", label: "Moji zaslužki", icon: "earnings" },
        { href: "/profile", label: "Profil", icon: "profile" },
      ],
    },
  ],
};

/** Route prefixes each role may open (page-level guard; data is still protected by RLS). */
export const ROUTE_ACCESS: Record<string, Role[]> = {
  "/pipeline": ["owner", "agent"],
  "/calendar": ["owner", "agent", "caller"],
  "/policies": ["owner", "agent"],
  "/appointments/new": ["owner", "caller", "agent"],
  "/follow-ups": ["owner", "caller"],
  "/employees": ["owner"],
  "/payroll": ["owner"],
  "/reports": ["owner"],
  "/export": ["owner"],
  "/deleted": ["owner"],
  "/renewals": ["owner", "agent"],
  "/leads": ["owner", "caller"],
  "/settings": ["owner"],
};
