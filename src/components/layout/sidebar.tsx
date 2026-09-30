"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavSection } from "@/config/navigation";
import { NavIcon } from "./nav-icon";
import { cn } from "@/lib/utils";

export type NavCounts = { followups?: number; pendingResults?: number; leadsDue?: number };

export function SidebarNav({ sections, counts, onNavigate }: { sections: NavSection[]; counts: NavCounts; onNavigate?: () => void }) {
  const pathname = usePathname();
  const allHrefs = sections.flatMap((s) => s.items.map((i) => i.href));
  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === href;
    if (!(pathname === href || pathname.startsWith(href + "/"))) return false;
    // prefer the most specific match (e.g. /appointments/new over /appointments)
    return !allHrefs.some((h) => h !== href && h.startsWith(href + "/") && (pathname === h || pathname.startsWith(h + "/")));
  };

  return (
    <nav className="flex flex-col gap-6 px-3 py-4">
      {sections.map((section, i) => (
        <div key={i}>
          {section.title && <p className="mb-1.5 px-3 font-brand text-[10px] font-semibold tracking-[0.2em] text-gold/80 uppercase">{section.title}</p>}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = isActive(item.href);
              const count = item.badge ? counts[item.badge] : undefined;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                      active ? "bg-white/10 font-semibold text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r bg-gold" aria-hidden />}
                    <NavIcon name={item.icon} className={cn("size-[18px] shrink-0", active && "text-gold")} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {!!count && <span className="min-w-6 rounded-full bg-gold px-1.5 text-center text-xs font-bold text-ink tabular">{count}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
