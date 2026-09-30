/**
 * Dashboard composition per role. Reorder/remove widget keys here —
 * widgets are independent components that fetch their own data.
 */
import type { Role } from "@/types/domain";

export type WidgetKey =
  | "quickActions"
  | "kpis"
  | "today"
  | "upcoming"
  | "results"
  | "productionByAgent"
  | "productionByCaller"
  | "upcomingPayouts"
  | "obligations"
  | "recentActivity"
  | "followups";

export const DASHBOARD_LAYOUT: Record<Role, { top: WidgetKey[]; main: WidgetKey[]; side: WidgetKey[] }> = {
  owner: {
    main: ["kpis", "today", "productionByAgent", "productionByCaller", "recentActivity"],
    top: ["quickActions"],
    side: ["results", "obligations", "upcomingPayouts", "upcoming"],
  },
  agent: {
    main: ["kpis", "today", "upcoming"],
    side: ["results", "upcomingPayouts"],
    top: ["quickActions"],
  },
  caller: {
    main: ["kpis", "followups", "upcoming"],
    side: ["results", "upcomingPayouts"],
    top: ["quickActions"],
  },
};
