import { cn } from "@/lib/utils";

/**
 * ZZ Partnerji wordmark: ZZ | PARTNERJI with the tagline "Vaš zavarovalni
 * partner", drawn as SVG text (Montserrat) so it stays crisp at any size and
 * on light (tone="dark") or dark green (tone="light") backgrounds.
 * Proportions follow the official horizontal logo.
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
  const width = size === "lg" ? "w-full max-w-80" : size === "md" ? "w-[200px]" : "w-32";
  const main = tone === "dark" ? "#023933" : "#ffffff";
  const sub = tone === "dark" ? "#3a6460" : "rgb(255 255 255 / 0.6)";
  // without the tagline, PARTNERJI is centred against ZZ
  const partnerjiY = tagline ? 19 : 23.75;
  return (
    <svg
      viewBox="0 0 229 34.5"
      role="img"
      aria-label="ZZ Partnerji – vaš zavarovalni partner"
      className={cn("block h-auto font-brand", width, className)}
    >
      <text x="1" y="30.5" fontSize="38.6" fontWeight="400" fill={main} textLength="47.5" lengthAdjust="spacingAndGlyphs">
        ZZ
      </text>
      <rect x="61.5" y="0.5" width="1.6" height="33.5" fill="#c4ae86" />
      <text x="75" y={partnerjiY} fontSize="18.6" fontWeight="500" fill={main} textLength="144" lengthAdjust="spacing">
        PARTNERJI
      </text>
      {tagline && (
        <text x="75" y="29.5" fontSize="6.7" fontWeight="500" fill={sub} textLength="153" lengthAdjust="spacing">
          VAŠ ZAVAROVALNI PARTNER
        </text>
      )}
    </svg>
  );
}

/** Compact ZZ|P mark (e.g. collapsed header). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-[0.2em] font-brand text-lg leading-none font-normal text-ink", className)} aria-hidden>
      ZZ<span className="h-[1.1em] w-[2px] bg-gold" />P
    </span>
  );
}
