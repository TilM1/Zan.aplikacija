/**
 * Dashboard composition per role. Reorder/remove widget keys here —
 * widgets are independent components that fetch their own data.
 */
import type { Role } from "@/types/domain";

export type WidgetKey =
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

export const DASHBOARD_LAYOUT: Record<Role, { main: WidgetKey[]; side: WidgetKey[] }> = {
  owner: {
    main: ["kpis", "today", "productionByAgent", "productionByCaller", "recentActivity"],
    side: ["results", "obligations", "upcomingPayouts", "upcoming"],
  },
  agent: {
    main: ["kpis", "today", "upcoming"],
    side: ["results", "upcomingPayouts"],
  },
  caller: {
    main: ["kpis", "followups", "upcoming"],
    side: ["results", "upcomingPayouts"],
  },
};
