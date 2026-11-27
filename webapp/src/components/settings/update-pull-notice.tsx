"use client";

import { AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { pullFixCommand, type PullFailure } from "@/lib/update-status";

/**
 * The top of Settings when the automatic update could not fetch or pull the
 * install's files (kinboard-self-update.sh, update_pull). Until now that was
 * only in the updater's log on the server: a household whose folder git
 * refused saw no update and no reason. Shown until a run fetches and pulls
 * again; there is nothing to dismiss, the fix is on the server.
 */
export function UpdatePullNotice({ failure }: { failure: PullFailure | null | undefined }) {
  const t = useTranslations("settings.updateStatus");
  const locale = useLocale();
  if (!failure) return null;

  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : format(d, "PPp", { locale: getDateFnsLocale(locale) });
  };
  const command = pullFixCommand(failure);
  const body =
    failure.kind === "ownership"
      ? t("pullOwnership")
      : failure.kind === "permission"
        ? t("pullPermission")
        : failure.kind === "pull"
          ? t("pullLocal")
          : t("pullFetch");

  return (
    <div
      role="alert"
      data-testid="update-pull-notice"
      data-kind={failure.kind}
      className="mb-6 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning-strong" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-display text-base font-semibold">
            {failure.kind === "pull" ? t("pullLocalTitle") : t("pullTitle")}
          </p>
          <p className="text-sm text-muted-foreground">
            {body}
            {failure.at ? ` ${t("pullAt", { time: when(failure.at) })}` : ""}
          </p>
          {command && (
            <>
              <p className="text-sm text-muted-foreground">
                {failure.kind === "pull" ? t("pullFixLocal") : t("pullFix")}
              </p>
              <pre
                data-testid="update-pull-command"
                className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-background/60 p-2 font-mono text-xs"
              >
                {command}
              </pre>
            </>
          )}
          {failure.detail && failure.kind !== "pull" && (
            <p className="break-words font-mono text-xs text-muted-foreground">{failure.detail}</p>
          )}
          {failure.logFile && <p className="text-xs text-muted-foreground">{t("detailsLog", { log: failure.logFile })}</p>}
        </div>
      </div>
    </div>
  );
}
