"use client";

import { motion } from "framer-motion";
import { Monitor, Clock, Radar, Power, ImageIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useScreensaverSettings, useUpdateScreensaverSettings } from "@/hooks/use-screensaver-settings";
import { useFamilyStore } from "@/stores/family-store";
import { usePresence } from "@/hooks/use-presence";
import { PageHeader } from "@/components/page-header";

// Numeric values; labels resolved per-locale via t() at render
const SCREENSAVER_TIMEOUTS = [
  { value: "60", labelKey: "minutes1" },
  { value: "120", labelKey: "minutes2" },
  { value: "300", labelKey: "minutes5" },
  { value: "600", labelKey: "minutes10" },
  { value: "0", labelKey: "timeoutOff" },
] as const;

const PHOTO_ROTATION_INTERVALS = [
  { value: "10", labelKey: "seconds10" },
  { value: "15", labelKey: "seconds15" },
  { value: "30", labelKey: "seconds30" },
  { value: "60", labelKey: "seconds60" },
  { value: "120", labelKey: "seconds120" },
  { value: "300", labelKey: "seconds300" },
] as const;

const PRESENCE_TIMEOUTS = [
  { value: "10", labelKey: "seconds10" },
  { value: "30", labelKey: "seconds30" },
  { value: "60", labelKey: "seconds60" },
  { value: "120", labelKey: "seconds120" },
  { value: "300", labelKey: "seconds300" },
] as const;

export default function ScreensaverSettingsPage() {
  const t = useTranslations("settings.screensaver");
  const { device } = useFamilyStore();
  const { settings, isLoading, screensaverTimeout, presenceTimeout, presenceControlMode, photoRotationInterval } = useScreensaverSettings();
  const updateSettings = useUpdateScreensaverSettings();
  const presence = usePresence();

  const hasPresenceSensor = device?.has_presence_sensor ?? false;

  const handleTimeoutChange = (value: string) => {
    updateSettings.mutate({
      key: "screensaver",
      value: { ...settings, screensaverTimeout: parseInt(value, 10) },
    });
  };

  const handlePresenceTimeoutChange = (value: string) => {
    updateSettings.mutate({
      key: "screensaver",
      value: { ...settings, presenceTimeout: parseInt(value, 10) },
    });
  };

  const handlePhotoIntervalChange = (value: string) => {
    updateSettings.mutate({
      key: "screensaver",
      value: { ...settings, photoRotationInterval: parseInt(value, 10) },
    });
  };

  const handleControlModeChange = (value: string) => {
    updateSettings.mutate({
      key: "screensaver",
      value: { ...settings, presenceControlMode: value as "screensaver" | "display_power" },
    });
  };

  if (isLoading) {
    return (
      <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
          <Skeleton className="h-12 w-48" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto">
        <PageHeader
          icon={Monitor}
          title={t("title")}
          subtitle={t("subtitle")}
          className="mb-8"
        />

        {/* Inactivity Timeout */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-6"
        >
          <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
            {t("timeoutHeading")}
          </h2>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock className="size-5 text-primary" />
                <div>
                  <Label className="font-medium">{t("timeoutLabel")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {hasPresenceSensor
                      ? t("timeoutFallback")
                      : t("timeoutDescription")}
                  </p>
                </div>
              </div>
              <Select
                value={screensaverTimeout.toString()}
                onValueChange={handleTimeoutChange}
                disabled={updateSettings.isPending}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCREENSAVER_TIMEOUTS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>
        </motion.div>

        {/* Photo Rotation Interval */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mb-6"
        >
          <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
            {t("rotationHeading")}
          </h2>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ImageIcon className="size-5 text-primary" />
                <div>
                  <Label className="font-medium">{t("rotationLabel")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("rotationDescription")}
                  </p>
                </div>
              </div>
              <Select
                value={photoRotationInterval.toString()}
                onValueChange={handlePhotoIntervalChange}
                disabled={updateSettings.isPending}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PHOTO_ROTATION_INTERVALS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>
        </motion.div>

        {/* Presence Sensor Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center gap-2 mb-3 px-1">
            <h2 className="text-sm font-medium text-muted-foreground">
              {t("presenceHeading")}
            </h2>
            {hasPresenceSensor ? (
              <Badge variant="default" className="text-xs bg-success">{t("presenceEnabledBadge")}</Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">{t("presenceUnavailableBadge")}</Badge>
            )}
          </div>

          <Card className={`p-4 ${!hasPresenceSensor ? "opacity-50" : ""}`}>
            {hasPresenceSensor ? (
              <div className="flex flex-col gap-4">
                {/* Status indicator */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className={`size-3 rounded-full ${
                      presence.stale
                        ? "bg-warning"
                        : presence.detected
                        ? "bg-success animate-pulse"
                        : "bg-destructive"
                    }`} />
                    <span className="text-sm">
                      {presence.stale
                        ? t("presenceConnectionLost")
                        : presence.detected
                        ? t("presenceDetected")
                        : t("presenceNone")}
                    </span>
                  </div>
                  {presence.distance && !presence.stale && (
                    <span className="text-xs text-muted-foreground">
                      ~{presence.distance} cm
                    </span>
                  )}
                </div>

                {/* Control Mode.
                    "Display off" is deliberately not selectable. Switching a
                    panel's power means driving the compositor (Mutter's
                    PowerSaveMode over D-Bus, or DPMS) and a browser tab
                    simply cannot do that — the Wake Lock API keeps a screen
                    awake, it can't put one to sleep. The kiosk's own
                    presence-sensor service does the real DPMS work, on its
                    own timer, and never read this setting anyway. Rather
                    than leave a switch that quietly does nothing, the option
                    stays visible (families who picked it still see their
                    stored value) but is disabled and explained. */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Radar className="size-5 text-primary" />
                    <div>
                      <Label className="font-medium">{t("presenceModeLabel")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {t("presenceModeDescription")}
                      </p>
                    </div>
                  </div>
                  <Select
                    value={presenceControlMode}
                    onValueChange={handleControlModeChange}
                    disabled={updateSettings.isPending}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="screensaver">
                        <div className="flex items-center gap-2">
                          <Monitor className="size-4" />
                          {t("presenceModeScreensaver")}
                        </div>
                      </SelectItem>
                      <SelectItem value="display_power" disabled>
                        <div className="flex items-center gap-2">
                          <Power className="size-4" />
                          {t("presenceModeDisplay")}
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <p className="text-xs text-muted-foreground -mt-2">
                  {t("presenceModeDisplayUnavailable")}
                </p>

                {/* Presence Timeout */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Clock className="size-5 text-primary" />
                    <div>
                      <Label className="font-medium">{t("presenceTimeoutLabel")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {t("presenceTimeoutDescription")}
                      </p>
                    </div>
                  </div>
                  <Select
                    value={presenceTimeout.toString()}
                    onValueChange={handlePresenceTimeoutChange}
                    disabled={updateSettings.isPending}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRESENCE_TIMEOUTS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {t(option.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <Radar className="size-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-1">
                  {t("presenceUnavailableTitle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.rich("presenceUnavailableHint", {
                    link: (chunks) => <span className="text-primary">{chunks}</span>,
                  })}
                </p>
              </div>
            )}
          </Card>
        </motion.div>

        {/* Info Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-6"
        >
          <Card className="p-4">
            <h3 className="font-medium mb-2">{t("infoHeading")}</h3>
            <ul className="text-sm text-muted-foreground flex flex-col gap-1.5">
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                {t("info1")}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                {t("info2")}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                {t("info3")}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                {t("info4")}
              </li>
            </ul>
          </Card>
        </motion.div>
      </div>
    </main>
  );
}
