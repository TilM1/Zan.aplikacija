import { CalendarPlus, CheckCircle2, FileText, MessageSquare, PhoneCall, Pencil, UserPlus, Wallet, ScrollText } from "lucide-react";
import type { TimelineEntry, TimelineKind } from "@/lib/activity";
import { formatDateTime } from "@/lib/dates";
import { ResultBadge } from "@/components/ui/status";
import { cn } from "@/lib/utils";

const ICONS: Record<TimelineKind, { icon: typeof FileText; cls: string }> = {
  create: { icon: UserPlus, cls: "bg-brand-soft text-brand" },
  appointment: { icon: CalendarPlus, cls: "bg-info-soft text-info" },
  result: { icon: CheckCircle2, cls: "bg-subtle text-ink-2" },
  followup: { icon: PhoneCall, cls: "bg-warning-soft text-warning" },
  policy: { icon: ScrollText, cls: "bg-success-soft text-success" },
  money: { icon: Wallet, cls: "bg-accent-soft text-accent" },
  document: { icon: FileText, cls: "bg-subtle text-ink-2" },
  note: { icon: MessageSquare, cls: "bg-subtle text-ink-2" },
  change: { icon: Pencil, cls: "bg-subtle text-ink-3" },
};

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return <p className="px-4 py-6 text-sm text-ink-3">Ni zabeleženih dogodkov.</p>;
  return (
    <ol className="relative px-4 py-3">
      {entries.map((e, i) => {
        const { icon: Icon, cls } = ICONS[e.kind];
        return (
          <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < entries.length - 1 && <span className="absolute top-7 bottom-0 left-3.5 w-px bg-line" aria-hidden />}
            <span className={cn("relative z-10 grid size-7 shrink-0 place-items-center rounded-full", cls)}>
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium">{e.title}</span>
                {e.result && <ResultBadge result={e.result} withLabel={false} />}
              </div>
              {e.detail && <p className={cn("mt-0.5 text-sm text-ink-2", e.kind === "note" && "whitespace-pre-wrap")}>{e.detail}</p>}
              <p className="mt-0.5 text-xs text-ink-3">
                {formatDateTime(e.at)} · {e.actor}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
