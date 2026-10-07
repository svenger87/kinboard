import { type ReactNode, useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface ChecklistItemProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  /** Right-aligned meta: quantity (tabular-nums) or a <PersonAvatar/>. */
  meta?: ReactNode;
  /** Context color (person/primary) for the unchecked checkbox border. */
  color?: string;
  /**
   * A denser row for a small widget: less padding, and a label that fills the
   * row's height, so the whole row is what is tapped.
   */
  compact?: boolean;
  className?: string;
}

export function ChecklistItem({
  checked,
  onCheckedChange,
  label,
  meta,
  color,
  compact = false,
  className,
}: ChecklistItemProps) {
  const id = useId();
  return (
    <div
      className={cn(
        "flex items-center rounded-xl border border-border bg-card elev-sm transition-opacity [transition-duration:120ms]",
        compact ? "min-h-[40px] gap-2.5 px-3" : "min-h-[52px] gap-3 px-4",
        checked && "opacity-55",
        className
      )}
    >
      <span
        className="inline-flex [&_.peer~div]:border-[color:var(--ci-color)]"
        style={
          color && !checked
            ? ({ ["--ci-color" as string]: color } as React.CSSProperties)
            : undefined
        }
      >
        <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} />
      </span>
      <label
        htmlFor={id}
        className={cn("min-w-0 flex-1 cursor-pointer text-sm [overflow-wrap:anywhere]", compact && "flex items-center self-stretch py-1.5", checked && "line-through")}
      >
        {label}
      </label>
      {/* Capped so a long amount ("2 Stück + 1 Packung") wraps inside the row
          instead of pushing the row past its card; an avatar never gets near. */}
      {meta != null && (
        <span className="ml-auto max-w-[45%] shrink-0 text-right text-sm text-muted-foreground [overflow-wrap:anywhere]">{meta}</span>
      )}
    </div>
  );
}
