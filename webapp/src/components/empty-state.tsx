import { Plus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: "default" | "outline" | "link";
    disabled?: boolean;
  };
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center",
        className
      )}
    >
      <span className="icon-badge" style={{ background: "hsl(var(--primary) / 0.10)" }}>
        <Icon className="size-6" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="font-display text-lg font-semibold">{title}</p>
      {description && (
        <p className="max-w-[30ch] text-sm text-muted-foreground">{description}</p>
      )}
      {action && (
        <Button
          variant={action.variant || "link"}
          onClick={action.onClick}
          disabled={action.disabled}
          className="mt-1"
        >
          {action.variant === "default" && (
            <Plus className="size-4" strokeWidth={1.75} aria-hidden="true" />
          )}
          {action.label}
        </Button>
      )}
    </div>
  );
}
