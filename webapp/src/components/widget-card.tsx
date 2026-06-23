import { type ReactNode } from "react";
import Link from "next/link";
import { type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface WidgetCardProps {
  icon: LucideIcon;
  title: string;
  /** Right-aligned header slot: count badge, chevron, etc. */
  headerRight?: ReactNode;
  children?: ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
}

export function WidgetCard({
  icon: Icon,
  title,
  headerRight,
  children,
  href,
  onClick,
  className,
}: WidgetCardProps) {
  const header = (
    <div className="flex items-center gap-3">
      <span className="icon-badge">
        <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h3 className="flex-1 font-display text-lg font-semibold leading-tight">{title}</h3>
      {headerRight != null && <span className="ml-auto shrink-0">{headerRight}</span>}
    </div>
  );

  const inner = (
    <CardContent className="flex flex-col gap-4 p-[18px]">
      {header}
      {children}
    </CardContent>
  );

  const cardClass = cn("accent-border-top", (href || onClick) && "cursor-pointer", className);

  if (href) {
    return (
      <Link href={href} className="block">
        <Card className={cardClass}>{inner}</Card>
      </Link>
    );
  }

  if (onClick) {
    return (
      <Card
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className={cardClass}
      >
        {inner}
      </Card>
    );
  }

  return <Card className={cardClass}>{inner}</Card>;
}
