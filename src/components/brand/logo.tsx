import { cn } from "@/lib/utils";

/**
 * CoreMark wordmark, rendered as text so it stays crisp at any size and on
 * light or dark backgrounds: CORE | MARK with a gold divider.
 */
export function Logo({
  tone = "dark",
  size = "md",
  tagline = false,
  className,
}: {
  tone?: "dark" | "light";
  size?: "sm" | "md" | "lg";
  tagline?: boolean;
  className?: string;
}) {
  const text = size === "lg" ? "text-3xl" : size === "md" ? "text-xl" : "text-base";
  return (
    <span className={cn("inline-flex flex-col", className)} aria-label="CoreMark – celovita zavarovanja">
      <span className={cn("flex items-center font-brand leading-none font-normal tracking-[0.14em]", text)}>
        <span className={tone === "dark" ? "text-ink" : "text-white"}>CORE</span>
        <span className="mx-[0.45em] h-[1.15em] w-[2px] bg-gold" aria-hidden />
        <span className="text-gold">MARK</span>
      </span>
      {tagline && (
        <span className={cn("mt-2 font-brand text-[0.62rem] font-medium tracking-[0.42em] uppercase", tone === "dark" ? "text-ink-3" : "text-white/55")}>
          Celovita zavarovanja
        </span>
      )}
    </span>
  );
}

/** Compact C|M mark (e.g. collapsed header). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-[3px] font-sans text-lg leading-none font-black text-ink", className)} aria-hidden>
      C<span className="h-[0.95em] w-[3px] bg-gold" />M
    </span>
  );
}
