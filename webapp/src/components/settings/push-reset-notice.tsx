"use client";

import { useState } from "react";
import Link from "next/link";
import { BellOff, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { PushResetDevice } from "@/hooks/use-push-reset";

/**
 * The top of Settings after the server's push key changed (RFC-023 §6.4): a
 * restore without the config folder, or regenerated keys. The listed devices
 * had notifications on with the old key, and no longer receive any. The
 * notice goes away by itself as each device turns push on again, or when
 * dismissed (which removes the dead subscriptions).
 */
export function PushResetNotice({
  devices,
  currentDeviceId,
}: {
  devices: PushResetDevice[] | null | undefined;
  currentDeviceId?: string | null;
}) {
  const t = useTranslations("settings.pushReset");
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  if (!devices || devices.length === 0) return null;

  const names = devices
    .map((d) => (d.id === currentDeviceId ? t("thisDevice", { name: d.name }) : d.name))
    .filter(Boolean)
    .join(", ");
  const includesThis = !!currentDeviceId && devices.some((d) => d.id === currentDeviceId);

  const dismiss = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/notifications/push-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      if (!res.ok) throw new Error(`push-reset dismiss: ${res.status}`);
      await queryClient.invalidateQueries({ queryKey: ["push-reset"] });
    } catch (err) {
      console.error("push-reset:", err);
      toast.error(t("dismissFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      data-testid="push-reset-notice"
      className="mb-6 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <BellOff className="mt-0.5 size-5 shrink-0 text-warning-strong" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-display text-base font-semibold">{t("title")}</p>
          <p className="text-sm text-muted-foreground">{t("body")}</p>
          {names && <p className="text-sm text-muted-foreground">{t("devices", { names })}</p>}
          {includesThis && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/notifications">{t("open")}</Link>
              </Button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
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
