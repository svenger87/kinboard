import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: "default" | "outline" | "link" | "month";
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
        "flex flex-col items-center justify-center py-16 text-muted-foreground",
        className
      )}
    >
      <div className="relative mb-4">
        <div className="absolute inset-0 blur-2xl bg-month-primary/10 rounded-full scale-150" />
        <Icon className="size-12 relative text-month-primary/40" />
      </div>
      <p className="font-medium">{title}</p>
      {description && (
        <p className="text-sm mt-1 text-center max-w-sm">{description}</p>
      )}
      {action && (
        <Button
          variant={action.variant || "link"}
          onClick={action.onClick}
          className="mt-2"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
