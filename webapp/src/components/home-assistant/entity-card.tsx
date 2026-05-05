"use client";

import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";
import { SensorCard } from "./cards/sensor-card";
import { LightCard } from "./cards/light-card";
import { SwitchCard } from "./cards/switch-card";
import { VacuumCard } from "./cards/vacuum-card";
import { ClimateCard } from "./cards/climate-card";
import { CoverCard } from "./cards/cover-card";
import { FanCard } from "./cards/fan-card";
import { MediaPlayerCard } from "./cards/media-player-card";
import { LockCard } from "./cards/lock-card";
import { PersonCard } from "./cards/person-card";
import { WeatherCard } from "./cards/weather-card";
import { SceneCard } from "./cards/scene-card";
import { AlarmCard } from "./cards/alarm-card";
import { CameraCard } from "./cards/camera-card";
import { GenericCard } from "./cards/generic-card";

interface EntityCardProps {
  card: DashboardCard;
  entity: HAEntity | undefined;
  isLoading?: boolean;
}

export function EntityCard({ card, entity, isLoading }: EntityCardProps) {
  const t = useTranslations("homeAutomation");

  if (isLoading) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm p-4">
        <div className="flex items-start justify-between mb-3">
          <Skeleton className="size-10 rounded-xl" />
          <Skeleton className="h-3 w-12 rounded" />
        </div>
        <Skeleton className="h-4 w-2/3 mb-2 rounded" />
        <Skeleton className="h-6 w-1/2 rounded" />
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm p-4 opacity-60">
        <div className="flex items-start justify-between mb-2">
          <div className="p-2.5 rounded-xl bg-destructive/10">
            <AlertCircle className="size-5 text-destructive/60" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground truncate">
          {card.display_name || card.entity_id}
        </p>
        <p className="text-xs text-destructive/80 mt-0.5">{t("entityUnavailable")}</p>
      </div>
    );
  }

  // Route to specific card type
  switch (card.card_type) {
    // Sensors
    case "sensor":
    case "binary_sensor":
      return <SensorCard card={card} entity={entity} />;

    // Lights
    case "light":
      return <LightCard card={card} entity={entity} />;

    // Switches & Toggles
    case "switch":
    case "input_boolean":
    case "automation":
      return <SwitchCard card={card} entity={entity} />;

    // Vacuum
    case "vacuum":
      return <VacuumCard card={card} entity={entity} />;

    // Climate/HVAC
    case "climate":
      return <ClimateCard card={card} entity={entity} />;

    // Covers (blinds, garage doors)
    case "cover":
      return <CoverCard card={card} entity={entity} />;

    // Fans
    case "fan":
      return <FanCard card={card} entity={entity} />;

    // Media Players
    case "media_player":
      return <MediaPlayerCard card={card} entity={entity} />;

    // Locks
    case "lock":
      return <LockCard card={card} entity={entity} />;

    // Person & Device Trackers
    case "person":
    case "device_tracker":
      return <PersonCard card={card} entity={entity} />;

    // Weather
    case "weather":
      return <WeatherCard card={card} entity={entity} />;

    // Scenes & Scripts
    case "scene":
    case "script":
      return <SceneCard card={card} entity={entity} />;

    // Alarm Control Panel
    case "alarm_control_panel":
      return <AlarmCard card={card} entity={entity} />;

    // Cameras
    case "camera":
      return <CameraCard card={card} entity={entity} />;

    // Generic fallback
    default:
      return <GenericCard card={card} entity={entity} />;
  }
}
