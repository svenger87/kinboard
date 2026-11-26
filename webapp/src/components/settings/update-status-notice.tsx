"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { isPinRequired, relockSettings } from "@/lib/pin-session";
import { showsRollbackNotice, type UpdateStatus } from "@/lib/update-status";

/**
 * The top of Settings after an automatic update did not start and Kinboard
 * went back to the version before (RFC-023 §4.11.4). Shown until someone
 * dismisses it. "Try again now" releases the held-back version; the updater
 * picks that up at its next check.
 */
export function UpdateStatusNotice({ status }: { status: UpdateStatus | null | undefined }) {
  const t = useTranslations("settings.updateStatus");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!status || !showsRollbackNotice(status)) return null;

  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : format(d, "PPp", { locale: getDateFnsLocale(locale) });
  };

  const post = async (action: "dismiss" | "retry") => {
    setBusy(true);
    try {
      const res = await fetch("/api/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (await isPinRequired(res)) {
        relockSettings();
        return;
      }
      if (!res.ok) throw new Error(`update-status ${action}: ${res.status}`);
      if (action === "retry") toast.success(t("retryQueued"));
      await queryClient.invalidateQueries({ queryKey: ["update-status"] });
    } catch (err) {
      console.error("update-status:", err);
      toast.error(t("actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const failedRollback = status.status === "rollback_failed";

  return (
    <div
      role="alert"
      data-testid="update-rollback-notice"
      className="mb-6 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning-strong" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-display text-base font-semibold">
            {failedRollback
              ? t("rollbackFailedTitle", { version: status.to, previous: status.from })
              : t("rolledBackTitle", { version: status.to, previous: status.from })}
          </p>
          {failedRollback ? (
            <p className="text-sm text-muted-foreground">{t("rollbackFailedBody", { log: status.logFile })}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {status.backup
                ? t("dataBody", { time: when(status.backupAt || status.at), folder: status.backupDir })
                : t("dataBodyNoBackup")}
              {status.migration ? ` ${t("migrationBody", { file: status.migration })}` : ""}{" "}
              {t("retryLaterBody")}
            </p>
          )}
          {status.retryRequestedAt && <p className="text-sm text-muted-foreground">{t("retryPending")}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setDetailsOpen((o) => !o)} aria-expanded={detailsOpen}>
              {t("details")}
            </Button>
            {!failedRollback && !status.retryRequestedAt && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => post("retry")}>
                {t("tryAgain")}
              </Button>
            )}
          </div>
          {detailsOpen && (
            <div className="pt-1 text-xs text-muted-foreground space-y-1">
              <p>{t("detailsLog", { log: status.logFile })}</p>
              {status.log && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background/60 p-2 font-mono">
                  {status.log}
                </pre>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => post("dismiss")}
          disabled={busy}
          aria-label={t("dismiss")}
          className="-m-2 grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
