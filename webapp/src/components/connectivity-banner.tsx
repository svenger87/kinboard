"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { useErroredQueryCount } from "@/hooks/use-connectivity-status";
import { Button } from "@/components/ui/button";

/**
 * One page-level statement when the backend is broadly unreachable.
 *
 * Threshold of 2 rather than 1: a single failing query is a widget's own
 * problem and it reports that itself. Two or more settled failures means the
 * dashboard as a whole cannot be trusted, and on a wall display nobody is going
 * to open devtools to find that out (audit KB-05).
 */
export function ConnectivityBanner({ threshold = 2 }: { threshold?: number }) {
  const t = useTranslations("connectivity");
  const erroredCount = useErroredQueryCount();
  const queryClient = useQueryClient();

  if (erroredCount < threshold) return null;

  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3"
    >
      <AlertTriangle className="size-5 shrink-0 text-destructive" strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-semibold text-destructive">{t("title")}</p>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <Button
        variant="outline"
        onClick={() => queryClient.refetchQueries({ type: "active" })}
        className="gap-2"
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        {t("retry")}
      </Button>
    </div>
  );
}
