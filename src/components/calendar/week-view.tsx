import Link from "next/link";
import { cn } from "@/lib/utils";
import { addDays, formatTime, localParts, todayIso } from "@/lib/dates";
import { RESULT_LABELS } from "@/lib/labels";
import type { AppointmentWithRelations } from "@/types/domain";

const START_HOUR = 7;
const END_HOUR = 21;
const HOUR_PX = 56;
const DAY_NAMES = ["Pon", "Tor", "Sre", "Čet", "Pet", "Sob", "Ned"];

function tone(a: AppointmentWithRelations) {
  if (a.status === "completed" && a.result) {
    return {
      A1: "border-success/40 bg-success-soft text-success",
      A: "border-info/30 bg-info-soft text-info",
      A0: "border-danger/30 bg-danger-soft text-danger",
      B: "border-warning/40 bg-warning-soft text-warning",
    }[a.result];
  }
  return "border-brand/30 bg-brand-soft text-brand";
}

/** Internal CRM week calendar (Europe/Ljubljana). Appointments are DB entities, not UI state. */
export function WeekView({ weekStart, appointments, agentName, showAgent }: { weekStart: string; appointments: AppointmentWithRelations[]; agentName: (id: string) => string; showAgent: boolean }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = todayIso();
  const byDay = new Map<string, AppointmentWithRelations[]>(days.map((d) => [d, []]));
  for (const a of appointments) byDay.get(localParts(a.scheduled_at).date)?.push(a);

  return (
    <>
      {/* Desktop grid */}
      <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface md:block">
        <div className="grid min-w-[900px] grid-cols-[56px_repeat(7,1fr)]">
          <div className="border-b border-line" />
          {days.map((d, i) => (
            <div key={d} className={cn("border-b border-l border-line px-2 py-2 text-center text-xs", d === today && "bg-brand-soft")}>
              <span className="text-ink-3">{DAY_NAMES[i]}</span>{" "}
              <span className={cn("font-semibold", d === today && "text-brand")}>{d.slice(8, 10)}.{d.slice(5, 7)}.</span>
              <span className="ml-1 text-ink-3">({byDay.get(d)!.length})</span>
            </div>
          ))}
          <div className="relative">
            {Array.from({ length: END_HOUR - START_HOUR }, (_, h) => (
              <div key={h} style={{ height: HOUR_PX }} className="border-b border-line pr-1.5 text-right text-[11px] text-ink-3">
                {String(START_HOUR + h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className={cn("relative border-l border-line", d === today && "bg-brand-soft/30")} style={{ height: (END_HOUR - START_HOUR) * HOUR_PX }}>
              {Array.from({ length: END_HOUR - START_HOUR }, (_, h) => (
                <div key={h} style={{ top: h * HOUR_PX, height: HOUR_PX }} className="absolute inset-x-0 border-b border-line/70" />
              ))}
              {byDay.get(d)!.map((a) => {
                const { time } = localParts(a.scheduled_at);
                const [hh, mm] = time.split(":").map(Number);
                const top = Math.max(0, (hh - START_HOUR + mm / 60) * HOUR_PX);
                const height = Math.max(28, (a.duration_minutes / 60) * HOUR_PX - 3);
                return (
                  <Link
                    key={a.id}
                    href={`/customers/${a.customer_id}`}
                    style={{ top, height }}
                    className={cn("absolute inset-x-1 overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight hover:z-10 hover:shadow-md", tone(a))}
                    title={`${a.customer.first_name} ${a.customer.last_name} · ${a.location}`}
                  >
                    <p className="font-semibold">
                      {time} {a.result && `· ${RESULT_LABELS[a.result].short}`}
                    </p>
                    <p className="truncate text-ink">
                      {a.customer.first_name} {a.customer.last_name}
                    </p>
                    <p className="truncate text-ink-3">{showAgent ? agentName(a.agent_id) : `${a.postal_code ?? ""} ${a.customer.city ?? ""}`}</p>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile list */}
      <div className="flex flex-col gap-3 md:hidden">
        {days.map((d, i) => (
          <div key={d} className="rounded-lg border border-line bg-surface">
            <p className={cn("border-b border-line px-3 py-2 text-sm font-medium", d === today && "text-brand")}>
              {DAY_NAMES[i]} {d.slice(8, 10)}.{d.slice(5, 7)}.
            </p>
            {byDay.get(d)!.length === 0 ? (
              <p className="px-3 py-2 text-xs text-ink-3">Ni terminov</p>
            ) : (
              <ul className="divide-y divide-line">
                {byDay.get(d)!.map((a) => (
                  <li key={a.id}>
                    <Link href={`/customers/${a.customer_id}`} className="flex gap-3 px-3 py-2 text-sm">
                      <span className="w-12 font-medium tabular">{formatTime(a.scheduled_at)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {a.customer.first_name} {a.customer.last_name}
                        <span className="block text-xs text-ink-3">
                          {a.location}, {a.postal_code} {showAgent && `· ${agentName(a.agent_id)}`}
                        </span>
                      </span>
                      {a.result && <span className="text-xs font-semibold">{a.result}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
