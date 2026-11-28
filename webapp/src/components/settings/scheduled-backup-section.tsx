"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { formatSize } from "@/components/settings/old-database-notice";
import type { ScheduledBackupStatus } from "@/lib/scheduled-backup/runner";
import type { Frequency } from "@/lib/scheduled-backup/schedule";

/** What the route's refusals mean, as the key of their words. */
const ERRORS: Record<string, string> = {
  pin_invalid: "pinInvalid",
  pin_not_set: "pinNotSet",
  rate_limited: "rateLimited",
  busy: "busy",
  set_by_server: "setByServerError",
  no_backup: "noBackup",
  invalid_config: "invalidConfig",
};

type Action = "save" | "run" | "download";

function useWhen() {
  const locale = useLocale();
  return (iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : format(d, "PPp", { locale: getDateFnsLocale(locale) });
  };
}

/**
 * Settings → Data & backup, in the all-in-one image, for the install's
 * operator: the automatic backups (lib/scheduled-backup/). Off until switched
 * on here or by the server (KINBOARD_BACKUP_SCHEDULE, then shown as set by
 * the server and not changeable here). Saving, "Back up now" and "Download"
 * each ask for the settings PIN, as the old database's Delete does: each
 * backup holds every family's data and the keys that sign their logins.
 */
export function ScheduledBackupSection({ status }: { status: ScheduledBackupStatus | null | undefined }) {
  const t = useTranslations("settings.scheduledBackup");
  const locale = useLocale();
  const when = useWhen();
  const queryClient = useQueryClient();
  const cfg = status?.config;
  const [frequency, setFrequency] = useState<Frequency>(cfg?.frequency ?? "off");
  const [time, setTime] = useState(cfg?.time ?? "03:00");
  const [day, setDay] = useState(String(cfg?.day ?? 0));
  const [keep, setKeep] = useState(String(cfg?.keep ?? 7));
  const [pending, setPending] = useState<Action | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Follow what the server says until the household starts editing.
  const serverKey = cfg ? `${cfg.frequency}|${cfg.time}|${cfg.day}|${cfg.keep}` : "";
  useEffect(() => {
    if (!cfg) return;
    setFrequency(cfg.frequency);
    setTime(cfg.time);
    setDay(String(cfg.day));
    setKeep(String(cfg.keep));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const dayNames = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
    // 2026-11-29 is a Sunday.
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2026, 10, 29 + i))));
  }, [locale]);

  if (!status || !cfg) return null;

  const fromServer = cfg.source === "server";
  const keepNum = Number(keep);
  const keepOk = Number.isInteger(keepNum) && keepNum >= 1 && keepNum <= 365;
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const changed = frequency !== cfg.frequency || time !== cfg.time || Number(day) !== cfg.day || keepNum !== cfg.keep;
  const sizeOf = (b: number) => formatSize(b, locale);

  const open = (a: Action) => {
    setError(null);
    setPin("");
    setPending(a);
  };

  const submit = async () => {
    if (!pending || pin.length !== 4) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { action: pending, pin };
      if (pending === "save") body.config = { frequency, time, day: Number(day), keep: keepNum };
      const res = await fetch("/api/scheduled-backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
      if (!res.ok) {
        setError(t(ERRORS[out.error ?? ""] ?? "failed"));
        setPin("");
        return;
      }
      if (pending === "download" && out.url) {
        const a = document.createElement("a");
        a.href = out.url;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      if (pending === "save") toast.success(t("saved"));
      if (pending === "run") toast.success(t("started"));
      setPending(null);
      setPin("");
      await queryClient.invalidateQueries({ queryKey: ["scheduled-backup"] });
    } catch (err) {
      console.error("scheduled-backup:", err);
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  const last = status.lastSuccess;
  const newest = status.newest;
  const where =
    status.location.source === "data" ? t("whereData", { dir: status.location.dir })
    : status.location.sameDiskAsData ? t("whereSameDisk", { dir: status.location.dir })
    : t("whereSeparate", { dir: status.location.dir });

  return (
    <div id="scheduled-backup" data-setting="scheduled-backup" data-testid="scheduled-backup" className="mt-4 pt-4 border-t">
      <p className="font-medium text-sm">{t("title")}</p>
      <p className="text-sm text-muted-foreground mt-1">{t("description")}</p>

      {fromServer && (
        <p className="mt-3 rounded-md bg-muted/60 p-2 text-xs text-muted-foreground" data-testid="scheduled-backup-server">
          {t("setByServer")}
        </p>
      )}
      {cfg.error && (
        <p role="alert" className="mt-2 text-xs text-destructive" data-testid="scheduled-backup-config-error">
          {t("serverInvalid", { error: cfg.error })}
        </p>
      )}

      <fieldset disabled={fromServer} className="mt-3 space-y-3 disabled:opacity-70">
        <div>
          <p className="mb-1 text-xs font-medium" id="scheduled-backup-frequency">{t("frequencyLabel")}</p>
          <SegmentedControl
            value={frequency}
            onValueChange={(v) => setFrequency(v as Frequency)}
            aria-labelledby="scheduled-backup-frequency"
            className="w-full"
            disabled={fromServer}
          >
            <SegmentedControlItem value="off" className="flex-1">{t("off")}</SegmentedControlItem>
            <SegmentedControlItem value="daily" className="flex-1">{t("daily")}</SegmentedControlItem>
            <SegmentedControlItem value="weekly" className="flex-1">{t("weekly")}</SegmentedControlItem>
          </SegmentedControl>
        </div>
        {frequency !== "off" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {frequency === "weekly" && (
              <div>
                <Label htmlFor="scheduled-backup-day" className="mb-1 block text-xs">{t("dayLabel")}</Label>
                <Select value={day} onValueChange={setDay} disabled={fromServer}>
                  <SelectTrigger id="scheduled-backup-day" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dayNames.map((n, i) => (
                      <SelectItem key={i} value={String(i)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor="scheduled-backup-time" className="mb-1 block text-xs">{t("timeLabel", { zone: status.timeZone })}</Label>
              <Input id="scheduled-backup-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="scheduled-backup-keep" className="mb-1 block text-xs">{t("keepLabel")}</Label>
              <Input
                id="scheduled-backup-keep"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={keep}
                onChange={(e) => setKeep(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
        )}
        {!fromServer && (
          <Button
            variant="outline"
            className="w-full"
            data-testid="scheduled-backup-save"
            disabled={!changed || !keepOk || !timeOk}
            onClick={() => open("save")}
          >
            {t("save")}
          </Button>
        )}
      </fieldset>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" data-testid="scheduled-backup-status">
        <dt className="text-muted-foreground">{t("lastLabel")}</dt>
        <dd data-testid="scheduled-backup-last">
          {last ? t("lastValue", { date: when(last.finishedAt), size: sizeOf(last.bytes) }) : t("lastNone")}
        </dd>
        <dt className="text-muted-foreground">{t("nextLabel")}</dt>
        <dd data-testid="scheduled-backup-next">
          {status.running ? t("running") : status.nextRunAt ? when(status.nextRunAt) : t("nextOff")}
        </dd>
        <dt className="text-muted-foreground">{t("whereLabel")}</dt>
        <dd className="min-w-0 break-words">
          {where}
          {status.count > 0 && <span className="text-muted-foreground"> {t("count", { count: status.count })}</span>}
        </dd>
      </dl>

      {status.failing && status.lastAttempt?.error && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-xs text-destructive" data-testid="scheduled-backup-error">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {t("lastError", { date: when(status.lastAttempt.finishedAt), error: status.lastAttempt.error })}
          </span>
        </p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button variant="outline" data-testid="scheduled-backup-run" disabled={status.running} onClick={() => open("run")}>
          {status.running ? t("running") : t("runNow")}
        </Button>
        <Button variant="outline" data-testid="scheduled-backup-download" disabled={!newest} onClick={() => open("download")}>
          {newest ? t("download", { size: sizeOf(newest.bytes) }) : t("downloadNone")}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t("private")}</p>

      <Dialog open={pending !== null} onOpenChange={(o) => { if (!busy && !o) setPending(null); }}>
        <DialogContent data-scheduled-backup-dialog className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{pending ? t(`${pending}Title`) : ""}</DialogTitle>
            <DialogDescription>{pending ? t(`${pending}Body`) : ""}</DialogDescription>
          </DialogHeader>
          <form
            id="scheduled-backup-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Label htmlFor="scheduled-backup-pin">{t("pinLabel")}</Label>
            <Input
              id="scheduled-backup-pin"
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
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button type="submit" form="scheduled-backup-form" disabled={pin.length !== 4 || busy}>
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The top of Settings while the last automatic backup failed: what went
 * wrong, and since when the last good one is. Gone after the next good one.
 */
export function ScheduledBackupNotice({ status }: { status: ScheduledBackupStatus | null | undefined }) {
  const t = useTranslations("settings.scheduledBackup");
  const when = useWhen();
  if (!status?.failing || !status.lastAttempt) return null;
  const last = status.lastSuccess;
  return (
    <div
      role="alert"
      data-testid="scheduled-backup-notice"
      className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{t("noticeTitle")}</p>
          <p className="text-muted-foreground break-words">
            {t("noticeBody", { date: when(status.lastAttempt.finishedAt), error: status.lastAttempt.error ?? "" })}
          </p>
          <p className="text-muted-foreground">
            {last ? t("noticeLastGood", { date: when(last.finishedAt) }) : t("noticeNoGood")}
          </p>
          <a href="#scheduled-backup" className="text-xs font-medium underline underline-offset-2">
            {t("noticeLink")}
          </a>
        </div>
      </div>
    </div>
  );
}
