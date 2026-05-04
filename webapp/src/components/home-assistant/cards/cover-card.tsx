"use client";

import { useState } from "react";
import { Loader2, ChevronUp, ChevronDown, Pause, Blinds } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useCoverControl } from "@/hooks";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";

interface CoverCardProps {
  card: DashboardCard;
  entity: HAEntity;
}

type CoverStateKey = "open" | "opening" | "closed" | "closing";
const COVER_STATE_KEYS: readonly string[] = ["open", "opening", "closed", "closing"];

export function CoverCard({ card, entity }: CoverCardProps) {
  const t = useTranslations("homeAutomation.cards.cover");
  const tState = useTranslations("homeAutomation.entityState");
  const tCoverState = useTranslations("homeAutomation.coverState");
  const { open, close, stop, setPosition, isPending } = useCoverControl();
  const [localPosition, setLocalPosition] = useState<number | null>(null);

  const label = card.display_name || entity.name;
  const isUnavailable = entity.state === "unavailable";
  const currentState = entity.state;
  const currentPosition = entity.attributes.current_position as number | undefined;

  const isOpen = currentState === "open";
  const isClosed = currentState === "closed";
  const isOpening = currentState === "opening";
  const isClosing = currentState === "closing";
  const isMoving = isOpening || isClosing;

  const displayPosition = localPosition !== null ? localPosition : (currentPosition ?? 0);
  const supportsPosition = currentPosition !== undefined;

  const getStateColor = () => {
    if (isOpen) return "text-blue-500";
    if (isMoving) return "text-yellow-500";
    return "text-muted-foreground";
  };

  const handleOpen = async () => {
    if (isUnavailable) return;
    await open(entity.entity_id);
  };

  const handleClose = async () => {
    if (isUnavailable) return;
    await close(entity.entity_id);
  };

  const handleStop = async () => {
    if (isUnavailable) return;
    await stop(entity.entity_id);
  };

  const handlePositionChange = (value: number[]) => {
    setLocalPosition(value[0]);
  };

  const handlePositionCommit = async (value: number[]) => {
    await setPosition(entity.entity_id, value[0]);
    setLocalPosition(null);
  };

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        isOpen
          ? "bg-blue-500/10 border-blue-500/30"
          : isMoving
          ? "bg-yellow-500/10 border-yellow-500/30"
          : "bg-card hover:border-month-primary/30"
      } ${isUnavailable ? "opacity-50" : ""}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div
          className={`p-2 rounded-lg ${
            isOpen
              ? "bg-blue-500/20 text-blue-500"
              : isMoving
              ? "bg-yellow-500/20 text-yellow-500"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <Blinds className="size-5" />
        </div>
        <span className={`text-sm font-medium ${getStateColor()}`}>
          {isUnavailable
            ? tState("unavailable")
            : COVER_STATE_KEYS.includes(currentState)
              ? tCoverState(currentState as CoverStateKey)
              : currentState}
        </span>
      </div>

      {/* Label */}
      <p className="text-sm font-medium truncate mb-3">{label}</p>

      {/* Position Slider */}
      {supportsPosition && !isUnavailable && (
        <div className="mb-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("position")}</span>
            <span>{displayPosition}%</span>
          </div>
          <Slider
            value={[displayPosition]}
            min={0}
            max={100}
            step={5}
            onValueChange={handlePositionChange}
            onValueCommit={handlePositionCommit}
            disabled={isPending}
            className="cursor-pointer"
          />
        </div>
      )}

      {/* Control Buttons */}
      {!isUnavailable && (
        <div className="flex items-center justify-center gap-2 pt-2 border-t">
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            onClick={handleClose}
            disabled={isPending || isClosed}
            aria-label={t("closeAria")}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ChevronDown className="size-5" />
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            onClick={handleStop}
            disabled={isPending || !isMoving}
            aria-label={t("stopAria")}
          >
            <Pause className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            onClick={handleOpen}
            disabled={isPending || isOpen}
            aria-label={t("openAria")}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ChevronUp className="size-5" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
