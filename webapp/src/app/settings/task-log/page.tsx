"use client";

import { useState } from "react";
import { History, Check, Undo2, Plus, Pencil, Trash2, RotateCcw, type LucideIcon } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useDevices, usePeople, useSetting, useUpdateSetting } from "@/hooks";
import { useTodoEvents } from "@/hooks/use-todo-history";
import type { TodoEvent } from "@/types/database";

/** Settings key and default for how long the task log is kept (#341). */
const TASK_LOG_SETTING_KEY = "task_log";
const DEFAULT_RETENTION_DAYS = 90;
/** Offered retention windows, in days. 0 keeps everything. */
const WINDOWS = [30, 90, 365, 0] as const;
const PAGE = 100;

interface TaskLogSetting {
  retentionDays: number;
}

const KIND_ICONS: Record<TodoEvent["kind"], LucideIcon> = {
  created: Plus,
  edited: Pencil,
  completed: Check,
  uncompleted: Undo2,
  deleted: Trash2,
  restored: RotateCcw,
};

/**
 * Every time a task was ticked or un-ticked -- when, from which screen, and
 * whose turn it was -- and when it was created, edited, deleted or restored.
 * The calendar shows how each day ended; this shows how it got there. The
 * database writes it (migration_zzzzzy_todo_turns.sql); the page only reads.
 */
export default function TaskLogPage() {
  const t = useTranslations("settings.taskLog");
  const locale = useLocale();
  const [limit, setLimit] = useState(PAGE);

  const { data: setting } = useSetting<TaskLogSetting>(TASK_LOG_SETTING_KEY, { retentionDays: DEFAULT_RETENTION_DAYS });
  const updateSetting = useUpdateSetting<TaskLogSetting>();
  const retentionDays = setting?.retentionDays ?? DEFAULT_RETENTION_DAYS;

  const { data: events, isPending, isError, refetch } = useTodoEvents(limit);
  const { data: people } = usePeople();
  const { data: devices } = useDevices();

  async function setWindow(days: number) {
    try {
      await updateSetting.mutateAsync({ key: TASK_LOG_SETTING_KEY, value: { retentionDays: days } });
      toast.success(t("retentionSaved"));
    } catch {
      toast.error(t("retentionFailed"));
    }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const fmtDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  const personName = (id: string | null) => (id && people?.find((p) => p.id === id)?.name) || null;
  const personColor = (id: string | null) => (id && people?.find((p) => p.id === id)?.color) || undefined;

  const whereFrom = (event: TodoEvent) => {
    const device = event.device_id ? devices?.find((d) => d.id === event.device_id)?.name : null;
    if (device) return device;
    if (event.detail?.source === "integration") return t("sourceIntegration");
    if (event.detail?.source === "server") return t("sourceServer");
    return t("sourceUnknownDevice");
  };

  const fields = (event: TodoEvent) =>
    (event.detail?.fields ?? [])
      .map((field) => (t.has(`field.${field}`) ? t(`field.${field}`) : field))
      .join(", ");

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader icon={History} title={t("title")} subtitle={t("subtitle")} />

        <Card className="flex flex-col gap-3 p-6">
          <h2 className="font-medium">{t("retentionHeading")}</h2>
          <p className="text-sm text-muted-foreground">{t("retentionBody")}</p>
          <div className="flex flex-wrap gap-2">
            {WINDOWS.map((d) => (
              <Button
                key={d}
                variant={retentionDays === d ? "default" : "outline"}
                className="min-h-[44px]"
                onClick={() => void setWindow(d)}
                aria-pressed={retentionDays === d}
              >
                {d === 0 ? t("keepForever") : d === 365 ? t("oneYear") : t("days", { count: d })}
              </Button>
            ))}
          </div>
        </Card>

        {isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        )}

        {isError && (
          <Card className="p-6">
            <p className="text-sm text-destructive">{t("loadFailed")}</p>
            <Button variant="outline" className="mt-3" onClick={() => void refetch()}>
              {t("retry")}
            </Button>
          </Card>
        )}

        {events && events.length === 0 && (
          <Card className="p-8">
            <EmptyState icon={History} title={t("emptyTitle")} description={t("emptyDescription")} />
          </Card>
        )}

        {events && events.length > 0 && (
          <Card className="p-2">
            <ol className="flex flex-col divide-y divide-border/30">
              {events.map((event) => {
                const Icon = KIND_ICONS[event.kind] ?? Pencil;
                const turn = personName(event.person_id);
                const changed = event.kind === "edited" ? fields(event) : "";
                return (
                  <li key={event.id} className="flex items-start gap-3 px-3 py-3">
                    <span
                      className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
                        event.kind === "completed"
                          ? "bg-success/15 text-success"
                          : event.kind === "uncompleted" || event.kind === "deleted"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted/50 text-muted-foreground"
                      }`}
                      aria-hidden="true"
                    >
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="font-medium">{event.detail?.title ?? t("untitled")}</span>
                        {" · "}
                        {t(`kind.${event.kind}`)}
                        {changed && <span className="text-muted-foreground"> ({changed})</span>}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <time dateTime={event.at}>{fmt(event.at)}</time>
                        <span>· {whereFrom(event)}</span>
                        {event.day && <span>· {t("forDay", { day: fmtDay(event.day) })}</span>}
                        {turn && (
                          <span className="inline-flex items-center gap-1">
                            · <span className="size-2 rounded-full" style={{ backgroundColor: personColor(event.person_id) }} />
                            {t("turnOf", { name: turn })}
                          </span>
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {events.length >= limit && (
              <div className="flex justify-center p-2">
                <Button variant="outline" className="min-h-[44px]" onClick={() => setLimit(limit + PAGE)}>
                  {t("showMore")}
                </Button>
              </div>
            )}
          </Card>
        )}
      </div>
    </main>
  );
}
