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
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center py-16",
        className
      )}
    >
      <div className="relative mb-3">
        <div className="absolute inset-0 blur-2xl bg-destructive/10 rounded-full scale-150" />
        <Icon className="size-12 relative text-destructive/60" />
      </div>
      <p className="text-destructive font-medium">{resolvedTitle}</p>
      {message && (
        <p className="text-sm text-muted-foreground mt-1 text-center max-w-sm">
          {message}
        </p>
      )}
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-4 gap-2">
          <RefreshCw className="size-4" />
          {resolvedRetryLabel}
        </Button>
      )}
    </div>
  );
}
