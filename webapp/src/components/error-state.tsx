"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  icon?: LucideIcon;
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  icon: Icon = AlertCircle,
  title,
  message,
  onRetry,
  retryLabel,
  className,
}: ErrorStateProps) {
  const t = useTranslations("components");
  const resolvedTitle = title ?? t("errorTitle");
  const resolvedRetryLabel = retryLabel ?? t("retry");
  return (
    // Deliberately the same container, spacing, icon treatment and title style
    // as EmptyState. These are sibling states of the same surface and they used
    // to look nothing alike: EmptyState had a dashed card, this had no
    // container at all, a 48px icon behind a blurred glow and a smaller,
    // differently-weighted title (audit KB-30). Only the accent colour and the
    // presence of a retry distinguish them now.
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-destructive/40 bg-destructive/[0.06] px-6 py-12 text-center",
        className
      )}
    >
      <span className="icon-badge" style={{ background: "hsl(var(--destructive) / 0.12)", color: "hsl(var(--destructive))" }}>
        <Icon className="size-6" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="font-display text-lg font-semibold text-destructive">{resolvedTitle}</p>
      {message && (
        <p className="max-w-[34ch] text-sm text-muted-foreground">{message}</p>
      )}
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-1 gap-2">
          <RefreshCw className="size-4" />
          {resolvedRetryLabel}
        </Button>
      )}
    </div>
  );
}
