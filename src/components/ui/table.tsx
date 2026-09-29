import Link from "next/link";
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}
export function THead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="bg-subtle/60 text-left" {...props} />;
}
export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("border-b border-line px-3 py-2 text-xs font-medium whitespace-nowrap text-ink-3", className)} {...props} />;
}
export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-line last:border-0 hover:bg-subtle/50", className)} {...props} />;
}
export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}

/**
 * Sortable column header (server component). First click sorts by the
 * column's natural direction, the next click reverses it.
 */
export function SortTH({
  label,
  column,
  sort,
  hrefFor,
  firstDesc = false,
  className,
}: {
  label: string;
  column: string;
  sort: string;
  hrefFor: (sort: string) => string;
  firstDesc?: boolean;
  className?: string;
}) {
  const active = sort.replace(/^-/, "") === column;
  const desc = sort.startsWith("-");
  const next = active ? (desc ? column : `-${column}`) : firstDesc ? `-${column}` : column;
  return (
    <TH className={className} aria-sort={active ? (desc ? "descending" : "ascending") : "none"}>
      <SortLink href={hrefFor(next)} active={active} desc={desc} label={label} />
    </TH>
  );
}

export function SortLink({ href, active, desc, label }: { href: string; active: boolean; desc: boolean; label: string }) {
  return (
    <Link href={href} scroll={false} className={cn("inline-flex items-center gap-1 hover:text-ink", active && "text-ink")}>
      {label}
      <span className={cn("text-[10px]", !active && "opacity-30")}>{active ? (desc ? "▼" : "▲") : "▲▼"}</span>
    </Link>
  );
}
