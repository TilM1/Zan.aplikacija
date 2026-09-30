import Link from "next/link";
import { CalendarDays, ClipboardCheck, Coins, KanbanSquare, PhoneCall, PlusCircle, UserPlus, Users, Wallet, type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/dates";
import { getNavCounts } from "@/server/queries/nav";
import type { Profile } from "@/types/domain";
import { cn } from "@/lib/utils";

interface Action {
  href: string;
  title: string;
  hint: string;
  icon: LucideIcon;
  primary?: boolean;
  count?: number;
}

/** Big, obvious entry points for the most common tasks of each role. */
export async function QuickActions({ profile }: { profile: Profile }) {
  const counts = await getNavCounts(profile);
  let duePayouts = 0;
  if (profile.role === "owner") {
    const supabase = await createClient();
    const { count } = await supabase
      .from("commission_installments")
      .select("id", { count: "exact", head: true })
      .eq("status", "scheduled")
      .lte("due_date", todayIso());
    duePayouts = count ?? 0;
  }

  const actions: Action[] =
    profile.role === "caller"
      ? [
          { href: "/appointments/new", title: "Nov termin", hint: "Stranka je potrdila termin", icon: PlusCircle, primary: true },
          { href: "/follow-ups", title: "Klici nazaj", hint: "Stranke, ki jih ni bilo doma", icon: PhoneCall, count: counts.followups },
          { href: "/appointments", title: "Moji termini", hint: "Kaj se je zgodilo s termini", icon: CalendarDays },
          { href: "/earnings", title: "Moji zaslužki", hint: "Provizije in izplačila", icon: Coins },
        ]
      : profile.role === "agent"
        ? [
            { href: "/pipeline?view=table&status=pending", title: "Vnesi rezultate", hint: "Termini, ki čakajo na rezultat", icon: ClipboardCheck, primary: true, count: counts.pendingResults },
            { href: "/pipeline", title: "Moj pipeline", hint: "Vsi moji termini na enem mestu", icon: KanbanSquare },
            { href: "/calendar", title: "Koledar", hint: "Termini ta teden", icon: CalendarDays },
            { href: "/earnings", title: "Moji zaslužki", hint: "Provizije in izplačila", icon: Coins },
          ]
        : [
            { href: "/appointments/new", title: "Nov termin", hint: "Vnesi stranko in termin", icon: PlusCircle, primary: true },
            { href: "/pipeline?view=table&status=pending", title: "Vnesi rezultate", hint: "Moji termini brez rezultata", icon: ClipboardCheck, count: counts.pendingResults },
            { href: "/payroll", title: "Izplačila", hint: "Zapadle provizije za plačilo", icon: Wallet, count: duePayouts },
            { href: "/employees", title: "Zaposleni", hint: "Dodaj osebo, provizije, dostop", icon: profile.role === "owner" ? UserPlus : Users },
          ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {actions.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className={cn(
            "group flex items-center gap-4 rounded-xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md",
            a.primary ? "border-gold bg-gold text-ink hover:bg-gold-hover" : "border-line bg-surface hover:border-gold",
          )}
        >
          <span className={cn("grid size-11 shrink-0 place-items-center rounded-lg", a.primary ? "bg-ink text-gold" : "bg-gold-soft text-brand")}>
            <a.icon className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 font-brand text-[15px] font-semibold">
              {a.title}
              {!!a.count && <span className={cn("rounded-full px-2 text-xs font-bold tabular", a.primary ? "bg-ink text-gold" : "bg-gold text-ink")}>{a.count}</span>}
            </span>
            <span className={cn("block truncate text-xs", a.primary ? "text-ink/75" : "text-ink-3")}>{a.hint}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
