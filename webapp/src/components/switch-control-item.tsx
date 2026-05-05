"use client";

import { Power, Loader2, ToggleLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { useCallService } from "@/hooks/use-home-assistant";
import type { HAEntity, RoomEntity } from "@/types/home-assistant";

interface SwitchControlItemProps {
  roomEntity: RoomEntity;
  entity: HAEntity;
}

export function SwitchControlItem({ roomEntity, entity }: SwitchControlItemProps) {
  const tState = useTranslations("homeAutomation.entityState");
  const { mutateAsync: callService, isPending } = useCallService();

  const isOn = entity.state === "on";
  const isUnavailable = entity.state === "unavailable";
  const label = roomEntity.display_name || entity.name;
  const domain = entity.domain; // "switch" or "input_boolean"

  const handleToggle = async () => {
    if (isUnavailable) return;

    await callService({
      domain,
      service: isOn ? "turn_off" : "turn_on",
      entity_id: entity.entity_id,
    });
  };

  return (
    <div
      className={`rounded-xl border p-3 transition-all ${
        isOn
          ? "border-blue-500/30 bg-blue-500/10"
          : "bg-card"
      } ${isUnavailable ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`p-2 rounded-lg transition-colors ${
            isOn ? "bg-blue-500/20 text-blue-500" : "bg-muted text-muted-foreground"
          }`}
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : domain === "input_boolean" ? (
            <ToggleLeft className="size-4" />
          ) : (
            <Power className="size-4" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{label}</p>
          <p className="text-xs text-muted-foreground">
            {isUnavailable ? tState("unavailable") : isOn ? tState("on") : tState("off")}
          </p>
        </div>

        <Switch
          checked={isOn}
          onCheckedChange={handleToggle}
          disabled={isPending || isUnavailable}
        />
      </div>
    </div>
  );
}
