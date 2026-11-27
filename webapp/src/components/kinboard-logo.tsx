import { cn } from "@/lib/utils";

/**
 * Kinboard's mark, the PWA icon (/icons/icon-192.png, from assets/logos/).
 * Decorative by default: next to a heading that already says "Kinboard" a
 * second announcement is noise.
 */
export function KinboardMark({ className }: { className?: string }) {
  return (
    // A plain <img>: a 192px static icon gains nothing from the image optimiser.
    <img src="/icons/icon-192.png" alt="" width={192} height={192} draggable={false} className={cn("select-none", className)} />
  );
}

/**
 * Mark plus wordmark. The wordmark is text in the theme's foreground colour
 * rather than assets/logos/kinboard-banner.png, whose navy lettering
 * disappears on the dark theme. One image to assistive technology, named
 * "Kinboard".
 */
export function KinboardLogo({ className }: { className?: string }) {
  return (
    <div role="img" aria-label="Kinboard" data-testid="kinboard-logo" className={cn("inline-flex items-center gap-3", className)}>
      <KinboardMark className="size-12 shrink-0" />
      <span className="font-display text-2xl font-semibold tracking-tight">Kinboard</span>
    </div>
  );
}
