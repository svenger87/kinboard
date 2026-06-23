import { type ReactNode, useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface ChecklistItemProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  /** Right-aligned meta: quantity (font-mono) or a <PersonAvatar/>. */
  meta?: ReactNode;
  /** Context color (person/primary) for the unchecked checkbox border. */
  color?: string;
  className?: string;
}

export function ChecklistItem({
  checked,
  onCheckedChange,
  label,
  meta,
  color,
  className,
}: ChecklistItemProps) {
  const id = useId();
  return (
    <div
      className={cn(
        "flex min-h-[52px] items-center gap-3 rounded-xl border border-border bg-card px-4 elev-sm transition-opacity [transition-duration:120ms]",
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
        className={cn("min-w-0 flex-1 cursor-pointer text-sm", checked && "line-through")}
      >
        {label}
      </label>
      {meta != null && (
        <span className="ml-auto shrink-0 text-sm text-muted-foreground">{meta}</span>
      )}
    </div>
  );
}
