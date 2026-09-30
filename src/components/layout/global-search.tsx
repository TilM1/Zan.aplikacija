"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

/** Global customer search (name, phone, e-mail, postal code) → /customers?q= */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        router.push(term ? `/customers?q=${encodeURIComponent(term)}` : "/customers");
      }}
      className="relative max-w-md"
    >
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Išči stranke – ime, telefon, e-pošta…"
        className="h-10 w-full rounded-lg border border-line bg-subtle pr-12 pl-9 text-[15px] placeholder:text-ink-3 focus:border-gold focus:bg-surface focus:ring-3 focus:ring-gold/20 focus:outline-none"
        aria-label="Iskanje strank"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-line px-1 text-[10px] text-ink-3 sm:block">⌘K</kbd>
    </form>
  );
}
