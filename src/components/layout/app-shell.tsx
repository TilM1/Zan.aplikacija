"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import type { NavSection } from "@/config/navigation";
import { SidebarNav, type NavCounts } from "./sidebar";
import { GlobalSearch } from "./global-search";
import { UserMenu } from "./user-menu";
import { Logo, LogoMark } from "@/components/brand/logo";

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
    <Link href="/dashboard" className="block border-b border-white/10 px-6 pt-6 pb-5">
      <Logo tone="light" size="md" tagline />
    </Link>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-y-auto bg-sidebar lg:flex">
        {brand}
        <SidebarNav sections={sections} counts={counts} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col overflow-y-auto bg-sidebar">
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

      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur lg:px-8">
        <button onClick={() => setMobileOpen(true)} className="flex items-center gap-2 rounded-lg p-1.5 text-ink-2 hover:bg-subtle lg:hidden" aria-label="Odpri meni">
          <Menu className="size-5" />
          <LogoMark className="text-base" />
        </button>
        <div className="min-w-0 flex-1">{canSearch && <GlobalSearch />}</div>
        {user.isDemo && <span className="hidden rounded bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning sm:inline">DEMO račun</span>}
        <UserMenu user={user} />
      </header>

      <main className="mx-auto w-full max-w-[1600px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
