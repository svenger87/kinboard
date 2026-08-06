"use client";

import { Lock, Unlock, Loader2, AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useLockControl } from "@/hooks";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";

type LockStateKey = "locked" | "unlocked" | "locking" | "unlocking" | "jammed";
const LOCK_STATE_KEYS: readonly string[] = ["locked", "unlocked", "locking", "unlocking", "jammed"];

interface LockCardProps {
  card: DashboardCard;
  entity: HAEntity;
}

export function LockCard({ card, entity }: LockCardProps) {
  const t = useTranslations("homeAutomation.cards.lock");
  const tState = useTranslations("homeAutomation.entityState");
  const tLockState = useTranslations("homeAutomation.lockState");
  const tCommon = useTranslations("common");
  const { lock, unlock, isPending } = useLockControl();

  const label = card.display_name || entity.name;
  const isUnavailable = entity.state === "unavailable";
  const isLocked = entity.state === "locked";
  const isUnlocked = entity.state === "unlocked";
  const isLocking = entity.state === "locking";
  const isUnlocking = entity.state === "unlocking";
  const isJammed = entity.state === "jammed";
  const isTransitioning = isLocking || isUnlocking;

  const getStateColor = () => {
    if (isLocked) return "text-state-on";
    if (isUnlocked) return "text-state-light";
    if (isJammed) return "text-state-alert";
    if (isTransitioning) return "text-state-cool";
    return "text-muted-foreground";
  };

  const getBgColor = () => {
    if (isLocked) return "bg-state-on/10 border-state-on/30";
    if (isUnlocked) return "bg-state-light/10 border-state-light/30";
    if (isJammed) return "bg-state-alert/10 border-state-alert/30";
    return "bg-card hover:border-primary/30";
  };

  const handleLock = async () => {
    if (isUnavailable) return;
    await lock(entity.entity_id);
  };

  const handleUnlock = async () => {
    if (isUnavailable) return;
    await unlock(entity.entity_id);
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
            isLocked
              ? "bg-state-on/20 text-state-on"
              : isUnlocked
              ? "bg-state-light/20 text-state-light"
              : isJammed
              ? "bg-state-alert/20 text-state-alert"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {isJammed ? (
            <AlertTriangle className="size-5" />
          ) : isLocked ? (
            <Lock className="size-5" />
          ) : (
            <Unlock className="size-5" />
          )}
        </div>
        <span className={`text-sm font-medium ${getStateColor()}`}>
          {isUnavailable
            ? tState("unavailable")
            : LOCK_STATE_KEYS.includes(entity.state)
              ? tLockState(entity.state as LockStateKey)
              : entity.state}
        </span>
      </div>

      {/* Label */}
      <p className="text-sm font-medium truncate mb-3">{label}</p>

      {/* Lock/Unlock Buttons with Confirmation */}
      {!isUnavailable && (
        <div className="flex items-center gap-2 pt-3 border-t">
          {isUnlocked || isJammed ? (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={handleLock}
              disabled={isPending || isTransitioning}
            >
              {isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Lock className="size-4 mr-2" />
              )}
              {t("lockButton")}
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={isPending || isTransitioning}
                >
                  {isPending ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Unlock className="size-4 mr-2" />
                  )}
                  {t("unlockButton")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("confirmDescription", { label })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleUnlock}>
                    {t("unlockButton")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}
    </div>
  );
}
