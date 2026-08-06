import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { personStrongTint, personText } from "@/lib/person-color";
import { MarqueeText } from "@/components/marquee-text";

export interface EventPillProps {
  title: string;
  color: string;
  /** Optional leading icon, e.g. Trash2 for garbage events (rendered 10px). */
  icon?: LucideIcon;
  /** "pill" = dense calendar-cell chip. "agenda" = mobile card w/ left border. */
  variant?: "pill" | "agenda";
  /** Agenda mode: time shown mono before the title. */
  time?: string;
  className?: string;
}

export function EventPill({
  title,
  color,
  icon: Icon,
  variant = "pill",
  time,
  className,
}: EventPillProps) {
  if (variant === "agenda") {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 elev-sm",
          className
        )}
        style={{ borderLeft: `4px solid ${color}` }}
      >
        {time && (
          <span
            className="shrink-0 text-sm font-bold tabular-nums"
            style={{ color: personText(color) }}
          >
            {time}
          </span>
        )}
        {Icon && <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
        <MarqueeText text={title} className="min-w-0 flex-1 text-sm font-medium" />
      </div>
    );
  }

  return (
    <span
      className={cn(
        "flex items-center gap-1 truncate rounded-[5px] px-1.5 py-0.5 text-[11px] font-semibold",
        className
      )}
      style={{ backgroundColor: personStrongTint(color), color: personText(color) }}
    >
      {Icon && <Icon className="size-[10px] shrink-0" strokeWidth={1.75} aria-hidden="true" />}
      <span className="truncate">{title}</span>
    </span>
  );
}
