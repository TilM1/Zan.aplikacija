import Link from "next/link";
import { KanbanSquare, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function ViewSwitch({ view, hrefFor }: { view: "kanban" | "table"; hrefFor: (v: "kanban" | "table") => string }) {
  const item = (v: "kanban" | "table", label: string, Icon: typeof Table2) => (
    <Link
      href={hrefFor(v)}
      className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-[13px]", view === v ? "bg-surface font-medium text-ink shadow-xs" : "text-ink-3 hover:text-ink")}
    >
      <Icon className="size-4" /> {label}
    </Link>
  );
  return (
    <div className="inline-flex rounded-md border border-line bg-subtle p-0.5">
      {item("kanban", "Kanban", KanbanSquare)}
      {item("table", "Tabela", Table2)}
    </div>
  );
}
