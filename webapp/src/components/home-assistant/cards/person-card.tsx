"use client";

import { User, MapPin, Clock, Battery } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { getIntlLocale } from "@/i18n/intl-locale";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";

interface PersonCardProps {
  card: DashboardCard;
  entity: HAEntity;
}

export function PersonCard({ card, entity }: PersonCardProps) {
  const t = useTranslations("homeAutomation.cards.person");
  const locale = useLocale();
  const intlLocale = getIntlLocale(locale);
  const label = card.display_name || entity.name;
  const isUnavailable = entity.state === "unavailable";
  const isUnknown = entity.state === "unknown" || entity.state === "not_home";
  const location = entity.state;

  // Person/device tracker attributes
  const latitude = entity.attributes.latitude as number | undefined;
  const longitude = entity.attributes.longitude as number | undefined;
  const gpsAccuracy = entity.attributes.gps_accuracy as number | undefined;
  const batteryLevel = entity.attributes.battery_level as number | undefined;
  const sourceType = entity.attributes.source_type as string | undefined;
  const entityPicture = entity.attributes.entity_picture as string | undefined;

  // Format last changed time
  const lastChanged = entity.last_changed;
  const lastSeenTime = lastChanged
    ? new Date(lastChanged).toLocaleTimeString(intlLocale, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const lastSeenDate = lastChanged
    ? new Date(lastChanged).toLocaleDateString(intlLocale, {
        day: "2-digit",
        month: "2-digit",
      })
    : null;

  const getLocationDisplay = () => {
    if (isUnknown) return t("locationUnknown");
    if (location === "home") return t("locationHome");
    // Capitalize zone names
    return location.charAt(0).toUpperCase() + location.slice(1);
  };

  const getStateColor = () => {
    if (location === "home") return "text-state-on";
    if (isUnknown) return "text-muted-foreground";
    return "text-state-cool";
  };

  const getBgColor = () => {
    if (location === "home") return "bg-state-on/10 border-state-on/30";
    if (isUnknown) return "bg-card hover:border-primary/30";
    return "bg-state-cool/10 border-state-cool/30";
  };

  return (
    <div
      className={`rounded-2xl border elev-sm p-4 transition-all ${getBgColor()} ${
        isUnavailable ? "opacity-50" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className={`p-2 rounded-lg ${
            location === "home"
              ? "bg-state-on/20 text-state-on"
              : isUnknown
              ? "bg-muted text-muted-foreground"
              : "bg-state-cool/20 text-state-cool"
          }`}
        >
          {entityPicture ? (
            <img
              src={entityPicture}
              alt={label}
              className="size-5 rounded-full object-cover"
            />
          ) : (
            <User className="size-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{label}</p>
          <div className={`flex items-center gap-1 text-xs ${getStateColor()}`}>
            <MapPin className="size-3" />
            <span>{getLocationDisplay()}</span>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        {/* Last Seen */}
        {lastSeenTime && (
          <div className="flex items-center gap-2">
            <Clock className="size-3" />
            <span>
              {t("lastSeen", { date: lastSeenDate ?? "", time: lastSeenTime ?? "" })}
            </span>
          </div>
        )}

        {/* Battery Level (if available) */}
        {batteryLevel !== undefined && (
          <div className="flex items-center gap-2">
            <Battery className="size-3" />
            <span>{batteryLevel}%</span>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  batteryLevel > 20 ? "bg-state-on" : "bg-state-alert"
                }`}
                style={{ width: `${batteryLevel}%` }}
              />
            </div>
          </div>
        )}

        {/* GPS Accuracy (if available) */}
        {gpsAccuracy !== undefined && gpsAccuracy > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-3xs text-muted-foreground">
              GPS ±{gpsAccuracy}m
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
