import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, icon: Icon = Inbox, action, className }: { title: string; description?: ReactNode; icon?: LucideIcon; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-3 rounded-full bg-subtle p-3 text-ink-3">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "default" | "warning" | "success" | "danger" }) {
  const body = (
    <>
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p
        className={cn(
          "tabular mt-1 text-2xl font-semibold tracking-tight",
          tone === "warning" && "text-warning",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
    </>
  );
  const cls = "block rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgb(0,0,0,0.04)]";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-gold hover:bg-gold-soft/40")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="Zavihki">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          className={cn(
            "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
            t.key === active ? "border-gold font-semibold text-ink" : "border-transparent text-ink-3 hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded bg-subtle px-1.5 text-xs text-ink-3 tabular">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="px-3 py-2 text-xs text-ink-3">{total} zapisov</p>;
  return (
    <div className="flex items-center justify-between px-3 py-2 text-xs text-ink-3">
      <span className="tabular">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} od {total}
      </span>
      <div className="flex gap-1">
        <PageLink href={hrefFor(page - 1)} disabled={page <= 1}>
          Nazaj
        </PageLink>
        <span className="tabular px-2 py-1">
          {page} / {pages}
        </span>
        <PageLink href={hrefFor(page + 1)} disabled={page >= pages}>
          Naprej
        </PageLink>
      </div>
    </div>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: ReactNode }) {
  if (disabled) return <span className="rounded-md border border-line px-2 py-1 opacity-40">{children}</span>;
  return (
    <Link href={href} className="rounded-md border border-line-strong bg-surface px-2 py-1 text-ink-2 hover:bg-subtle">
      {children}
    </Link>
  );
}

export function KeyValue({ items, className, wrap = false }: { items: { label: string; value: ReactNode }[]; className?: string; wrap?: boolean }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs text-ink-3">{i.label}</dt>
          <dd className={cn("mt-0.5 text-sm text-ink", wrap ? "break-words" : "truncate")}>{i.value ?? "–"}</dd>
        </div>
      ))}
    </dl>
  );
}
