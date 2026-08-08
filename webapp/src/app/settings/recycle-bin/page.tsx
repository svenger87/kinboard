"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Trash2, RotateCcw, Undo2 } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import { useFamilyStore } from "@/stores/family-store";
import { useSetting, useUpdateSetting } from "@/hooks";
import {
  DEFAULT_RETENTION_DAYS,
  RECYCLE_BIN_SETTING_KEY,
  RESTORES_DEPENDENTS,
  type DeletedRow,
} from "@/lib/recycle-bin";

/** Offered retention windows, in days. 0 keeps everything. */
const WINDOWS = [7, 30, 90, 0] as const;

interface RecycleBinSetting {
  retentionDays: number;
}

export default function RecycleBinPage() {
  const t = useTranslations("settings.recycleBin");
  const locale = useLocale();
  const { family } = useFamilyStore();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data: setting } = useSetting<RecycleBinSetting>(RECYCLE_BIN_SETTING_KEY, {
    retentionDays: DEFAULT_RETENTION_DAYS,
  });
  const updateSetting = useUpdateSetting<RecycleBinSetting>();
  const retentionDays = setting?.retentionDays ?? DEFAULT_RETENTION_DAYS;

  // Deleted rows are hidden from the browser by RLS on purpose, so the bin is
  // read through the server rather than with the usual PostgREST query.
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["recycle-bin", family?.id],
    queryFn: async (): Promise<DeletedRow[]> => {
      const r = await fetch(`/api/recycle-bin?family_id=${family!.id}`);
      if (!r.ok) throw new Error(`recycle-bin: ${r.status}`);
      return ((await r.json()) as { items: DeletedRow[] }).items;
    },
    enabled: !!family?.id,
  });

  const act = useMutation({
    mutationFn: async (input: { table: string; id: string; action: "restore" | "purge" }) => {
      const r = await fetch("/api/recycle-bin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, family_id: family?.id }),
      });
      if (!r.ok) throw new Error(`${input.action}: ${r.status}`);
    },
    onSuccess: () => {
      // Everything on the page could have changed, and this is a rare action —
      // a blanket invalidate is cheaper than tracking which lists the row is in.
      void qc.invalidateQueries();
    },
  });

  async function run(item: DeletedRow, action: "restore" | "purge") {
    setBusy(item.id);
    try {
      await act.mutateAsync({ table: item.table, id: item.id, action });
      toast.success(action === "restore" ? t("restored") : t("purged"));
    } catch {
      toast.error(action === "restore" ? t("restoreFailed") : t("purgeFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function setWindow(days: number) {
    try {
      await updateSetting.mutateAsync({
        key: RECYCLE_BIN_SETTING_KEY,
        value: { retentionDays: days },
      });
      toast.success(t("retentionSaved"));
    } catch {
      toast.error(t("retentionFailed"));
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader icon={Trash2} title={t("title")} subtitle={t("subtitle")} backHref="/settings" />

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
                {d === 0 ? t("keepForever") : t("days", { count: d })}
              </Button>
            ))}
          </div>
        </Card>

        {isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
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

        {!isPending && !isError && data && data.length === 0 && (
          <EmptyState icon={Trash2} title={t("emptyTitle")} description={t("emptyBody")} />
        )}

        {!isPending && data && data.length > 0 && (
          <div className="flex flex-col gap-2">
            {data.map((item, i) => (
              <motion.div
                key={`${item.table}:${item.id}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 8) * 0.03 }}
              >
                <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="break-words font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(`types.${item.table}` as never)} · {fmt(item.deleted_at)}
                      {item.subtitle ? ` · ${item.subtitle}` : ""}
                    </p>
                    {RESTORES_DEPENDENTS.includes(item.table) && (
                      // Restoring these brings their dependants back too, because
                      // the cascade was cancelled along with the delete. Saying so
                      // stops "will this come back empty?" being a reason not to.
                      <p className="mt-0.5 text-xs text-muted-foreground/80">{t("restoresDependents")}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      className="min-h-[44px] gap-2"
                      disabled={busy === item.id}
                      onClick={() => void run(item, "restore")}
                    >
                      <Undo2 className="size-4" />
                      {t("restore")}
                    </Button>
                    <ConfirmDestructive
                      title={t("purgeTitle")}
                      description={t("purgeBody")}
                      onConfirm={() => void run(item, "purge")}
                    >
                      <Button
                        variant="ghost"
                        className="min-h-[44px] text-destructive hover:text-destructive"
                        disabled={busy === item.id}
                        aria-label={t("purgeTitle")}
                      >
                        <RotateCcw className="size-4 rotate-180" />
                      </Button>
                    </ConfirmDestructive>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
