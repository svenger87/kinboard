import { cn } from "@/lib/utils";
import { personText, personTint } from "@/lib/person-color";

export interface PersonChipProps {
  name: string;
  color: string;
  /** Calendar filter state. false = greyed/neutral. Default true. */
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

export function PersonChip({
  name,
  color,
  selected = true,
  onClick,
  className,
}: PersonChipProps) {
  const base =
    "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors [transition-duration:120ms]";
  const style = selected
    ? { backgroundColor: personTint(color), color: personText(color) }
    : undefined;
  const content = (
    <>
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: selected ? color : undefined }}
        aria-hidden="true"
      />
      <span className="truncate">{name}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          base,
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          !selected && "bg-muted text-muted-foreground [&>span:first-child]:bg-muted-foreground/50",
          className
        )}
        style={style}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      className={cn(
        base,
        !selected && "bg-muted text-muted-foreground [&>span:first-child]:bg-muted-foreground/50",
        className
      )}
      style={style}
    >
      {content}
    </span>
  );
}
