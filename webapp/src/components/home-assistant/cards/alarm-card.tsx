"use client";

import { Shield, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useAlarmControl } from "@/hooks";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";

type AlarmStateKey =
  | "disarmed"
  | "armed_home"
  | "armed_away"
  | "armed_night"
  | "armed_vacation"
  | "armed_custom_bypass"
  | "pending"
  | "arming"
  | "disarming"
  | "triggered";

const ALARM_STATE_KEYS: readonly string[] = [
  "disarmed", "armed_home", "armed_away", "armed_night", "armed_vacation",
  "armed_custom_bypass", "pending", "arming", "disarming", "triggered",
];

interface AlarmCardProps {
  card: DashboardCard;
  entity: HAEntity;
}

export function AlarmCard({ card, entity }: AlarmCardProps) {
  const t = useTranslations("homeAutomation.cards.alarm");
  const tState = useTranslations("homeAutomation.entityState");
  const tAlarmState = useTranslations("homeAutomation.alarmState");
  const { disarm, armHome, armAway, armNight, isPending } = useAlarmControl();

  const label = card.display_name || entity.name;
  const isUnavailable = entity.state === "unavailable";
  const currentState = entity.state;

  const isDisarmed = currentState === "disarmed";
  const isArmedHome = currentState === "armed_home";
  const isArmedAway = currentState === "armed_away";
  const isArmedNight = currentState === "armed_night";
  const isArmed = isArmedHome || isArmedAway || isArmedNight || currentState.startsWith("armed");
  const isTriggered = currentState === "triggered";
  const isPending_ = currentState === "pending" || currentState === "arming" || currentState === "disarming";

  const getStateColor = () => {
    if (isTriggered) return "text-state-alert";
    if (isArmed) return "text-state-on";
    if (isDisarmed) return "text-state-light";
    if (isPending_) return "text-state-cool";
    return "text-muted-foreground";
  };

  const getBgColor = () => {
    if (isTriggered) return "bg-state-alert/10 border-state-alert/30";
    if (isArmed) return "bg-state-on/10 border-state-on/30";
    if (isDisarmed) return "bg-state-light/10 border-state-light/30";
    return "bg-card hover:border-primary/30";
  };

  const getIcon = () => {
    if (isTriggered) return <ShieldAlert className="size-5" />;
    if (isArmed) return <ShieldCheck className="size-5" />;
    return <Shield className="size-5" />;
  };

  const handleDisarm = async () => {
    if (isUnavailable) return;
    await disarm(entity.entity_id);
  };

  const handleArmHome = async () => {
    if (isUnavailable) return;
    await armHome(entity.entity_id);
  };

  const handleArmAway = async () => {
    if (isUnavailable) return;
    await armAway(entity.entity_id);
  };

  const handleArmNight = async () => {
    if (isUnavailable) return;
    await armNight(entity.entity_id);
  };

  return (
    <div
      className={`rounded-2xl border elev-sm p-4 transition-all ${getBgColor()} ${
        isUnavailable ? "opacity-50" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div
          className={`p-2 rounded-lg ${
            isTriggered
              ? "bg-state-alert/20 text-state-alert"
              : isArmed
              ? "bg-state-on/20 text-state-on"
              : isDisarmed
              ? "bg-state-light/20 text-state-light"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {getIcon()}
        </div>
        <span className={`text-sm font-medium ${getStateColor()}`}>
          {isUnavailable
            ? tState("unavailable")
            : ALARM_STATE_KEYS.includes(currentState)
              ? tAlarmState(currentState as AlarmStateKey)
              : currentState}
        </span>
      </div>

      {/* Label */}
      <p className="text-sm font-medium truncate mb-3">{label}</p>

      {/* Control Buttons */}
      {!isUnavailable && (
        <div className="flex flex-col gap-2 pt-3 border-t">
          {isArmed || isTriggered ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleDisarm}
              disabled={isPending || isPending_}
            >
              {isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Shield className="size-4 mr-2" />
              )}
              {t("disarmButton")}
            </Button>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={isArmedHome ? "default" : "outline"}
                size="sm"
                className="text-xs"
                onClick={handleArmHome}
                disabled={isPending || isPending_}
              >
                {isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  t("armHome")
                )}
              </Button>
              <Button
                variant={isArmedAway ? "default" : "outline"}
                size="sm"
                className="text-xs"
                onClick={handleArmAway}
                disabled={isPending || isPending_}
              >
                {isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  t("armAway")
                )}
              </Button>
              <Button
                variant={isArmedNight ? "default" : "outline"}
                size="sm"
                className="text-xs"
                onClick={handleArmNight}
                disabled={isPending || isPending_}
              >
                {isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  t("armNight")
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
