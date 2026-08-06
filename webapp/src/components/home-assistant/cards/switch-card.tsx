"use client";

import { useState } from "react";
import { Power, Loader2, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { useToggleEntity } from "@/hooks";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";
import { EntityDetailSheet } from "../entity-detail-sheet";

interface SwitchCardProps {
  card: DashboardCard;
  entity: HAEntity;
}

export function SwitchCard({ card, entity }: SwitchCardProps) {
  const tState = useTranslations("homeAutomation.entityState");
  const [detailOpen, setDetailOpen] = useState(false);
  const { toggle, isPending } = useToggleEntity();

  const isOn = entity.state === "on";
  const isUnavailable = entity.state === "unavailable";
  const label = card.display_name || entity.name;

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isUnavailable) return;
    await toggle(entity.entity_id, entity.state);
  };

  return (
    <>
      <div
        className={`rounded-2xl border bg-card elev-sm p-4 transition-all cursor-pointer ${
          isOn
            ? "bg-green-500/10 border-green-500/30"
            : "border-border hover:border-primary/30"
        } ${isUnavailable ? "opacity-50" : ""}`}
        onClick={() => setDetailOpen(true)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-xl transition-colors ${
                isOn ? "bg-green-500/20 text-green-500" : "bg-muted text-muted-foreground"
              }`}
            >
              {isPending ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Power className="size-5" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium truncate">{label}</p>
              <p className={`text-xs ${isOn ? "text-green-500" : "text-muted-foreground"}`}>
                {isUnavailable ? tState("unavailable") : isOn ? tState("on") : tState("off")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              aria-label={label}
              checked={isOn}
              onCheckedChange={() => {}}
              onClick={handleToggle}
              disabled={isPending || isUnavailable}
            />
            <ChevronRight className="size-4 text-muted-foreground" />
          </div>
        </div>
      </div>

      <EntityDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        card={card}
        entity={entity}
      />
    </>
  );
}
