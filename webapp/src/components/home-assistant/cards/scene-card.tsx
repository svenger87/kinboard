"use client";

import { Sparkles, Play, Loader2, Clock } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { getIntlLocale } from "@/i18n/intl-locale";
import { Button } from "@/components/ui/button";
import { useActivateScene } from "@/hooks";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";

interface SceneCardProps {
  card: DashboardCard;
  entity: HAEntity;
}

export function SceneCard({ card, entity }: SceneCardProps) {
  const t = useTranslations("homeAutomation.cards.scene");
  const locale = useLocale();
  const intlLocale = getIntlLocale(locale);
  const { activate, isPending } = useActivateScene();

  const label = card.display_name || entity.name;
  const isUnavailable = entity.state === "unavailable";
  const domain = entity.domain; // scene or script

  // Format last triggered time
  const lastChanged = entity.last_changed;
  const lastTriggered = lastChanged
    ? new Date(lastChanged).toLocaleString(intlLocale, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const handleActivate = async () => {
    if (isUnavailable) return;
    await activate(entity.entity_id);
  };

  return (
    <div
      className={`rounded-xl border p-4 transition-all bg-card hover:border-month-primary/30 ${
        isUnavailable ? "opacity-50" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
          <Sparkles className="size-5" />
        </div>
        <span className="text-xs text-muted-foreground">
          {domain === "script" ? t("typeScript") : t("typeScene")}
        </span>
      </div>

      {/* Label */}
      <p className="text-sm font-medium truncate mb-2">{label}</p>

      {/* Last Triggered */}
      {lastTriggered && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
          <Clock className="size-3" />
          <span>{t("lastTriggered", { time: lastTriggered })}</span>
        </div>
      )}

      {/* Activate Button */}
      {!isUnavailable && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleActivate}
          disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              {t("runningLabel")}
            </>
          ) : (
            <>
              <Play className="size-4 mr-2" />
              {domain === "script" ? t("execute") : t("activate")}
            </>
          )}
        </Button>
      )}
    </div>
  );
}
