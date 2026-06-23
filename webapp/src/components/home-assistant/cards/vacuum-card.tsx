"use client";

import { useState } from "react";
import {
  Play,
  Pause,
  Square,
  Home,
  Battery,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useVacuumCommand } from "@/hooks";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";

type VacuumStatusKey = "cleaning" | "docked" | "paused" | "idle" | "returning" | "error" | "charging";
const VACUUM_STATUS_KEYS: readonly string[] = ["cleaning", "docked", "paused", "idle", "returning", "error", "charging"];

// Vacuum icon SVG
function VacuumIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
    </svg>
  );
}

interface VacuumCardProps {
  card: DashboardCard;
  entity: HAEntity;
}

export function VacuumCard({ card, entity }: VacuumCardProps) {
  const t = useTranslations("homeAutomation.cards.vacuum");
  const tState = useTranslations("homeAutomation.entityState");
  const tStatus = useTranslations("homeAutomation.vacuumStatus");
  const { start, pause, stop, returnToBase, setFanSpeed, isPending } = useVacuumCommand();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const label = card.display_name || entity.name;
  const status = entity.state;
  const batteryLevel = entity.attributes.battery_level;
  const fanSpeed = entity.attributes.fan_speed;
  const fanSpeedList = entity.attributes.fan_speed_list || [];

  const isUnavailable = status === "unavailable";
  const isCleaning = status === "cleaning";
  const isPaused = status === "paused";
  const isDocked = status === "docked" || status === "idle";

  const statusLabel = VACUUM_STATUS_KEYS.includes(status) ? tStatus(status as VacuumStatusKey) : status;

  const getStatusColor = () => {
    if (isCleaning) return "text-green-500";
    if (isPaused) return "text-yellow-500";
    if (isDocked) return "text-blue-500";
    return "text-muted-foreground";
  };

  const handleAction = async (action: "start" | "pause" | "stop" | "dock") => {
    if (isUnavailable) return;
    setLoadingAction(action);
    try {
      switch (action) {
        case "start":
          await start(entity.entity_id);
          break;
        case "pause":
          await pause(entity.entity_id);
          break;
        case "stop":
          await stop(entity.entity_id);
          break;
        case "dock":
          await returnToBase(entity.entity_id);
          break;
      }
    } finally {
      setLoadingAction(null);
    }
  };

  const handleFanSpeedChange = async (speed: string) => {
    if (isUnavailable) return;
    setLoadingAction("fan");
    try {
      await setFanSpeed(entity.entity_id, speed);
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div
      className={`rounded-2xl border bg-card elev-sm p-4 transition-all ${
        isCleaning
          ? "bg-green-500/10 border-green-500/30"
          : "border-border hover:border-primary/30"
      } ${isUnavailable ? "opacity-50" : ""}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div
          className={`p-2.5 rounded-xl ${
            isCleaning ? "bg-green-500/20 text-green-500" : "bg-muted text-muted-foreground"
          }`}
        >
          <VacuumIcon className="size-5" />
        </div>
        {batteryLevel !== undefined && (
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Battery className="size-4" />
            <span>{batteryLevel}%</span>
          </div>
        )}
      </div>

      {/* Label and Status */}
      <div className="mb-4">
        <p className="text-sm font-medium truncate">{label}</p>
        <p className={`text-xs ${getStatusColor()}`}>
          {isUnavailable ? tState("unavailable") : statusLabel}
        </p>
      </div>

      {/* Action Buttons */}
      {!isUnavailable && (
        <div className="flex items-center gap-2">
          {!isCleaning && !isPaused && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleAction("start")}
              disabled={isPending}
              className="flex-1"
            >
              {loadingAction === "start" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              <span className="ml-1">{t("start")}</span>
            </Button>
          )}

          {isCleaning && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleAction("pause")}
              disabled={isPending}
              className="flex-1"
            >
              {loadingAction === "pause" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Pause className="size-4" />
              )}
              <span className="ml-1">{t("pause")}</span>
            </Button>
          )}

          {isPaused && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleAction("start")}
                disabled={isPending}
                className="flex-1"
              >
                {loadingAction === "start" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleAction("stop")}
                disabled={isPending}
              >
                {loadingAction === "stop" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Square className="size-4" />
                )}
              </Button>
            </>
          )}

          {(isCleaning || isPaused) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleAction("dock")}
              disabled={isPending}
            >
              {loadingAction === "dock" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Home className="size-4" />
              )}
            </Button>
          )}
        </div>
      )}

      {/* Fan Speed Selector */}
      {!isUnavailable && fanSpeedList.length > 0 && (
        <div className="mt-3 pt-3 border-t">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t("fanSpeedLabel")}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  disabled={isPending}
                >
                  {loadingAction === "fan" ? (
                    <Loader2 className="size-3 animate-spin mr-1" />
                  ) : null}
                  {fanSpeed || t("fanSpeedDefault")}
                  <ChevronDown className="size-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {fanSpeedList.map((speed) => (
                  <DropdownMenuItem
                    key={speed}
                    onClick={() => handleFanSpeedChange(speed)}
                    className={speed === fanSpeed ? "bg-accent" : ""}
                  >
                    {speed}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </div>
  );
}
