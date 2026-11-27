"use client";

import { useState } from "react";
import { Database } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import type { OldDatabaseStatus } from "@/lib/aio-old-database";

/** What the delete route's refusals mean, as the key of their words. */
const DELETE_ERRORS: Record<string, string> = {
  pin_invalid: "pinInvalid",
  pin_not_set: "pinNotSet",
  rate_limited: "rateLimited",
  rollback_window: "stillInWindow",
  upgrade_in_progress: "upgradeInProgress",
  nothing_to_delete: "nothingToDelete",
};

export function formatSize(bytes: number, locale: string): string {
  const mb = bytes / 1048576;
  const nf = (n: number, digits: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
  return mb >= 1024 ? `${nf(mb / 1024, 1)} GB` : `${nf(Math.max(mb, 0.1), mb < 10 ? 1 : 0)} MB`;
}

/**
 * Under the version in Settings, beside the compose file's notices: the
 * all-in-one image upgraded PostgreSQL and kept the database from before as
 * a folder (RFC-024 §4.3 step 4). While the previous version could still go
 * back to it, it says until when; after that, that it can be deleted, with a
 * Delete button behind the settings PIN.
 *
 * The route answers only the install's operator, and only in the all-in-one
 * image, so a compose install and every other family never see it.
 */
export function OldDatabaseNotice({ status }: { status: OldDatabaseStatus | null | undefined }) {
  const t = useTranslations("settings.oldDatabase");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!status) return null;

  const when = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : format(d, "PPp", { locale: getDateFnsLocale(locale) });
  };
  const size = formatSize(status.sizeBytes, locale);
  const versions = { from: status.fromMajor, to: status.toMajor };
  const upgraded = status.upgradedAt
    ? t("upgradedOn", { ...versions, date: when(status.upgradedAt) })
    : t("upgraded", versions);

  const remove = async () => {
    if (pin.length !== 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/old-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(t(DELETE_ERRORS[body.error ?? ""] ?? "deleteFailed"));
        setPin("");
        return;
      }
      toast.success(t("deleted", { size }));
      setOpen(false);
      setPin("");
      await queryClient.invalidateQueries({ queryKey: ["old-database"] });
    } catch (err) {
      console.error("old-database:", err);
      setError(t("deleteFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      data-testid="old-database-notice"
      data-rollback-open={status.rollbackOpen ? "true" : "false"}
      className="mx-auto mt-3 max-w-xl rounded-lg border border-border bg-muted/60 p-3 text-left text-xs text-foreground"
    >
      <div className="flex items-start gap-2">
        <Database className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-2">
          <p className="font-medium">{status.rollbackOpen ? t("keptTitle") : t("deletableTitle")}</p>
          <p className="text-muted-foreground">{upgraded}</p>
          {status.rollbackOpen ? (
            <p className="text-muted-foreground">
              {!status.rollbackUntil
                ? t("keptBodyUnconfirmed", { size, from: status.fromMajor })
                : status.previousVersion
                  ? t("keptBody", { size, previous: status.previousVersion, from: status.fromMajor, until: when(status.rollbackUntil) })
                  : t("keptBodyNoVersion", { size, from: status.fromMajor, until: when(status.rollbackUntil) })}
            </p>
          ) : (
            <>
              <p className="text-muted-foreground">
                {status.interrupted ? t("interruptedBody", { size }) : t("deletableBody", { size })}
              </p>
              <Button
                variant="outline"
                size="sm"
                data-testid="old-database-delete"
                onClick={() => { setError(null); setPin(""); setOpen(true); }}
              >
                {t("delete")}
              </Button>
            </>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
        <DialogContent data-old-database-dialog className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogBody", { size, from: status.fromMajor })}</DialogDescription>
          </DialogHeader>
          <form
            id="old-database-form"
            onSubmit={(e) => {
              e.preventDefault();
              void remove();
            }}
          >
            <Label htmlFor="old-database-pin">{t("pinLabel")}</Label>
            <Input
              id="old-database-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
            {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button type="submit" form="old-database-form" variant="destructive" disabled={pin.length !== 4 || busy}>
              {t("confirmDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
