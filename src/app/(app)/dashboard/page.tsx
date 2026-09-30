import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { requireSession } from "@/lib/auth";
import { todayIso, formatDate } from "@/lib/dates";
import { DASHBOARD_LAYOUT, type WidgetKey } from "@/config/dashboard";
import { PageHeader } from "@/components/ui/misc";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { LeaderboardWidget } from "@/components/dashboard/leaderboard-widget";
import {
  FollowupsWidget, KpisWidget, ObligationsWidget, ProductionByAgentWidget, ProductionByCallerWidget,
  RecentActivityWidget, ResultsWidget, TodayWidget, UpcomingPayoutsWidget, UpcomingWidget, type WidgetContext,
} from "@/components/dashboard/widgets";

export const metadata: Metadata = { title: "Nadzorna plošča" };

const WIDGETS: Record<WidgetKey, (ctx: WidgetContext) => ReactNode> = {
  quickActions: (ctx) => <QuickActions profile={ctx.profile} />,
  leaderboard: () => <LeaderboardWidget />,
  kpis: (ctx) => <KpisWidget ctx={ctx} />,
  today: (ctx) => <TodayWidget ctx={ctx} />,
  upcoming: (ctx) => <UpcomingWidget ctx={ctx} />,
  results: (ctx) => <ResultsWidget ctx={ctx} />,
  productionByAgent: () => <ProductionByAgentWidget />,
  productionByCaller: () => <ProductionByCallerWidget />,
  upcomingPayouts: (ctx) => <UpcomingPayoutsWidget ctx={ctx} />,
  obligations: () => <ObligationsWidget />,
  recentActivity: () => <RecentActivityWidget />,
  followups: (ctx) => <FollowupsWidget ctx={ctx} />,
};

function WidgetSlot({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="h-40 animate-pulse rounded-lg border border-line bg-surface" />}>{children}</Suspense>;
}

export default async function DashboardPage() {
  const { profile } = await requireSession();
  const today = todayIso();
  const ctx: WidgetContext = {
    profile,
    today,
    scope: profile.role === "owner" ? {} : profile.role === "agent" ? { agentId: profile.id } : { callerId: profile.id },
  };
  const layout = DASHBOARD_LAYOUT[profile.role];

  return (
    <>
      <PageHeader
        title={`Pozdravljeni, ${profile.first_name}`}
        description={`${formatDate(today)} · ${profile.role === "owner" ? "pregled celotnega poslovanja" : "vaš pregled"}`}
      />
      <div className="mb-5 flex flex-col gap-4">
        {layout.top.map((k) => (
          <WidgetSlot key={k}>{WIDGETS[k](ctx)}</WidgetSlot>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          {layout.main.map((k) => (
            <WidgetSlot key={k}>{WIDGETS[k](ctx)}</WidgetSlot>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {layout.side.map((k) => (
            <WidgetSlot key={k}>{WIDGETS[k](ctx)}</WidgetSlot>
          ))}
        </div>
      </div>
    </>
  );
}
