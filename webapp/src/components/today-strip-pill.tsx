import { cn } from "@/lib/utils";
import { personText } from "@/lib/person-color";

export interface TodayStripPillProps {
  time: string;
  title: string;
  /** Person color for the time text. */
  color: string;
  className?: string;
}

export function TodayStripPill({ time, title, color, className }: TodayStripPillProps) {
  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 elev-sm",
        className
      )}
    >
      {/* Raw person colour as text on a card — one of three different
          person-colour text strategies in the same design system (KB-09). */}
      <span className="text-sm font-bold tabular-nums" style={{ color: personText(color) }}>
        {time}
      </span>
      <span className="truncate text-sm font-medium">{title}</span>
    </div>
  );
}
