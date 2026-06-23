import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface IntegrationStatusRowProps {
  icon: LucideIcon;
  name: string;
  /** Secondary status text under the name. */
  status?: ReactNode;
  /** Right slot: a Foundation <Badge variant=...> or a dot. */
  right?: ReactNode;
  /** Optional override for the icon-badge color (else .icon-badge primary tint). */
  iconColor?: string;
  className?: string;
}

export function IntegrationStatusRow({
  icon: Icon,
  name,
  status,
  right,
  iconColor,
  className,
}: IntegrationStatusRowProps) {
  return (
    <div
      className={cn(
        "flex min-h-[56px] items-center gap-3 rounded-xl border border-border bg-card px-4 elev-sm",
        className
      )}
    >
      <span
        className="icon-badge"
        style={
          iconColor
            ? { color: iconColor, background: `color-mix(in srgb, ${iconColor}, transparent 88%)` }
            : undefined
        }
      >
        <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name}</p>
        {status != null && <p className="truncate text-xs text-muted-foreground">{status}</p>}
      </div>
      {right != null && <span className="ml-auto shrink-0">{right}</span>}
    </div>
  );
}
