"use client";

import { useState } from "react";
import { CircleDot, Loader2, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useCallService } from "@/hooks";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";
import { EntityDetailSheet } from "../entity-detail-sheet";

interface GenericCardProps {
  card: DashboardCard;
  entity: HAEntity;
}

export function GenericCard({ card, entity }: GenericCardProps) {
  const t = useTranslations("homeAutomation.cards.generic");
  const [detailOpen, setDetailOpen] = useState(false);
  const { mutateAsync: callService, isPending } = useCallService();

  const label = card.display_name || entity.name;
  const state = entity.state;
  const unit = entity.attributes.unit_of_measurement;
  const isUnavailable = state === "unavailable";

  // Check if this entity supports toggle (has turn_on/turn_off services)
  const domain = entity.domain;
  const supportsToggle = [
    "switch",
    "light",
    "fan",
    "cover",
    "input_boolean",
    "automation",
    "scene",
  ].includes(domain);

  const isOn = state === "on";

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isUnavailable || !supportsToggle) return;

    const service = isOn ? "turn_off" : "turn_on";
    await callService({
      domain,
      service,
      entity_id: entity.entity_id,
    });
  };

  const handleActivate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isUnavailable) return;
    await callService({
      domain,
      service: "turn_on",
      entity_id: entity.entity_id,
    });
  };

  return (
    <>
      <div
        className={`rounded-xl border border-white/[0.08] backdrop-blur-sm p-4 transition-all cursor-pointer ${
          supportsToggle && isOn
            ? "bg-month-primary/10 border-month-primary/30"
            : "bg-white/[0.03] hover:border-month-primary/30 hover:bg-white/[0.05]"
        } ${isUnavailable ? "opacity-50" : ""}`}
        onClick={() => setDetailOpen(true)}
      >
        <div className="flex items-start justify-between mb-2">
          <div
            className={`p-2.5 rounded-xl ${
              supportsToggle && isOn
                ? "bg-month-primary/20 text-month-primary"
                : "bg-white/[0.06] text-muted-foreground"
            }`}
          >
            <CircleDot className="size-5" />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{domain}</span>
            <ChevronRight className="size-4 text-muted-foreground/40" />
          </div>
        </div>

        <div className="mb-3">
          <p className="text-sm text-muted-foreground truncate">{label}</p>
          <p className="text-lg font-medium">
            {isUnavailable ? "---" : state}
            {unit && !isUnavailable && (
              <span className="text-sm text-muted-foreground ml-1">{unit}</span>
            )}
          </p>
        </div>

        {/* Action button for toggleable or activatable entities */}
        {!isUnavailable && supportsToggle && domain !== "scene" && (
          <Button
            variant={isOn ? "default" : "outline"}
            size="sm"
            className="w-full"
            onClick={handleToggle}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : null}
            {isOn ? t("turnOff") : t("turnOn")}
          </Button>
        )}

        {!isUnavailable && domain === "scene" && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleActivate}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : null}
            {t("activate")}
          </Button>
        )}
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
