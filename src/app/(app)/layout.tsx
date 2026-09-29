import { AppShell } from "@/components/layout/app-shell";
import { NAVIGATION } from "@/config/navigation";
import { requireSession } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/labels";
import { getNavCounts } from "@/server/queries/nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { profile } = await requireSession();
  const counts = await getNavCounts(profile);
  return (
    <AppShell
      sections={NAVIGATION[profile.role]}
      counts={counts}
      canSearch
      user={{
        firstName: profile.first_name,
        lastName: profile.last_name,
        email: profile.email,
        roleLabel: ROLE_LABELS[profile.role],
        isDemo: profile.is_demo,
      }}
    >
      {children}
    </AppShell>
  );
}
