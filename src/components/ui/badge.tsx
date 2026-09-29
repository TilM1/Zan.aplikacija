import type { ReactNode } from "react";
import type { Tone } from "@/lib/labels";
import { cn } from "@/lib/utils";

const tones: Record<Tone, string> = {
  neutral: "bg-subtle text-ink-2 ring-line-strong",
  info: "bg-info-soft text-info ring-info/20",
  success: "bg-success-soft text-success ring-success/20",
  warning: "bg-warning-soft text-warning ring-warning/25",
  danger: "bg-danger-soft text-danger ring-danger/20",
  accent: "bg-accent-soft text-accent ring-accent/20",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", tones[tone], className)}
    >
      {children}
    </span>
  );
}
