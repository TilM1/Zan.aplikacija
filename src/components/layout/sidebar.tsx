"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavSection } from "@/config/navigation";
import { NavIcon } from "./nav-icon";
import { cn } from "@/lib/utils";

export type NavCounts = { followups?: number; pendingResults?: number };

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
    <nav className="flex flex-col gap-5 px-3 py-4">
      {sections.map((section, i) => (
        <div key={i}>
          {section.title && <p className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-white/40 uppercase">{section.title}</p>}
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
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                      active ? "bg-white/12 font-medium text-white" : "text-white/70 hover:bg-white/6 hover:text-white",
                    )}
                  >
                    <NavIcon name={item.icon} className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {!!count && <span className="rounded-full bg-amber-400/90 px-1.5 text-[11px] font-semibold text-black tabular">{count}</span>}
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
