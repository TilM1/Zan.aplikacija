import {
  BarChart3, CalendarDays, CircleUserRound, ClipboardList, Download, FileText, KanbanSquare, LayoutDashboard,
  PhoneCall, PlusCircle, Settings, TrendingUp, Users, UsersRound, Wallet, Coins, ListChecks, ArchiveRestore, CalendarClock,
} from "lucide-react";
import type { NavIcon as NavIconName } from "@/config/navigation";

const ICONS = {
  dashboard: LayoutDashboard,
  pipeline: KanbanSquare,
  calendar: CalendarDays,
  customers: Users,
  policies: FileText,
  employees: UsersRound,
  payroll: Wallet,
  reports: BarChart3,
  export: Download,
  settings: Settings,
  new: PlusCircle,
  followups: PhoneCall,
  appointments: ClipboardList,
  production: TrendingUp,
  earnings: Coins,
  profile: CircleUserRound,
  leads: ListChecks,
  trash: ArchiveRestore,
  renewals: CalendarClock,
} as const;

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden />;
}
