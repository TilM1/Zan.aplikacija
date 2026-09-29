"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { signOut } from "@/server/actions/auth";
import { initials } from "@/lib/utils";
import type { ShellUser } from "./app-shell";

export function UserMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-md py-1 pr-1.5 pl-1 hover:bg-subtle" aria-expanded={open}>
        <span className="grid size-7 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{initials(user.firstName, user.lastName)}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-[13px] font-medium">
            {user.firstName} {user.lastName}
          </span>
          <span className="block text-[11px] text-ink-3">{user.roleLabel}</span>
        </span>
        <ChevronDown className="size-3.5 text-ink-3" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded-lg border border-line bg-surface p-1 shadow-lg">
          <p className="truncate px-2.5 py-2 text-xs text-ink-3">{user.email}</p>
          <Link href="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-subtle">
            <UserRound className="size-4" /> Profil
          </Link>
          <form action={signOut}>
            <button type="submit" className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-danger hover:bg-danger-soft">
              <LogOut className="size-4" /> Odjava
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
