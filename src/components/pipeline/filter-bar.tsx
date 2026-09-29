"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterDef {
  key: string;
  label: string;
  type: "select" | "date" | "search";
  options?: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
}

/** URL-driven filters: every change updates searchParams (shareable, back-button friendly). */
export function FilterBar({ filters, className }: { filters: FilterDef[]; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  return (
    <div className={cn("flex flex-wrap items-end gap-2", pending && "opacity-70", className)}>
      {filters.map((f) =>
        f.type === "search" ? (
          <SearchInput key={f.key} initial={params.get(f.key) ?? ""} placeholder={f.placeholder} onCommit={(v) => update(f.key, v)} />
        ) : (
          <label key={f.key} className={cn("flex flex-col gap-1", f.className)}>
            <span className="text-[11px] font-medium text-ink-3">{f.label}</span>
            {f.type === "select" ? (
              <select
                value={params.get(f.key) ?? ""}
                onChange={(e) => update(f.key, e.target.value)}
                className="h-8 rounded-md border border-line-strong bg-surface px-2 pr-7 text-[13px] focus:border-brand focus:outline-none"
              >
                {f.options!.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="date"
                value={params.get(f.key) ?? ""}
                onChange={(e) => update(f.key, e.target.value)}
                className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] focus:border-brand focus:outline-none"
              />
            )}
          </label>
        ),
      )}
    </div>
  );
}

function SearchInput({ initial, placeholder, onCommit }: { initial: string; placeholder?: string; onCommit: (v: string) => void }) {
  // Local state is the source of truth while typing; the URL is updated (debounced) from it.
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (value === initial) return;
    const t = setTimeout(() => onCommit(value.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="relative flex min-w-56 flex-1 flex-col gap-1 sm:max-w-xs">
      <span className="text-[11px] font-medium text-ink-3">Iskanje</span>
      <Search className="pointer-events-none absolute bottom-2 left-2 size-4 text-ink-3" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? "Išči…"}
        className="h-8 rounded-md border border-line-strong bg-surface pr-2 pl-7 text-[13px] focus:border-brand focus:outline-none"
      />
    </label>
  );
}
