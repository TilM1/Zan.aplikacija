"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import type { NavSection } from "@/config/navigation";
import { SidebarNav, type NavCounts } from "./sidebar";
import { GlobalSearch } from "./global-search";
import { UserMenu } from "./user-menu";

export interface ShellUser {
  firstName: string;
  lastName: string;
  email: string;
  roleLabel: string;
  isDemo: boolean;
}

export function AppShell({ sections, counts, user, canSearch, children }: { sections: NavSection[]; counts: NavCounts; user: ShellUser; canSearch: boolean; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2 px-5 py-4">
      <span className="grid size-7 place-items-center rounded-md bg-white text-[13px] font-bold text-brand">Z</span>
      <span className="text-sm font-semibold tracking-tight text-white">ZAN CRM</span>
    </Link>
  );

  return (
    <div className="min-h-dvh lg:pl-60">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col overflow-y-auto bg-[#141c26] lg:flex">
        {brand}
        <SidebarNav sections={sections} counts={counts} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col overflow-y-auto bg-[#141c26]">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button onClick={() => setMobileOpen(false)} className="rounded p-1 text-white/70" aria-label="Zapri meni">
                <X className="size-5" />
              </button>
            </div>
            <SidebarNav sections={sections} counts={counts} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur lg:px-6">
        <button onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 text-ink-2 hover:bg-subtle lg:hidden" aria-label="Odpri meni">
          <Menu className="size-5" />
        </button>
        <div className="min-w-0 flex-1">{canSearch && <GlobalSearch />}</div>
        {user.isDemo && <span className="hidden rounded bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning sm:inline">DEMO račun</span>}
        <UserMenu user={user} />
      </header>

      <main className="mx-auto w-full max-w-[1600px] px-4 py-5 lg:px-6 lg:py-6">{children}</main>
    </div>
  );
}
