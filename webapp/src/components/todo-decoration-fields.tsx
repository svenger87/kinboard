"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmojiIconField } from "@/components/emoji-picker";

export function TodoDecorationFields({
  icon,
  points,
  onIconChange,
  onPointsChange,
}: {
  icon: string;
  points: number;
  onIconChange: (icon: string) => void;
  onPointsChange: (points: number) => void;
}) {
  const t = useTranslations("todos");
  const pointsId = useId();
  const iconId = useId();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={iconId}>{t("fieldIcon")}</Label>
        {/* Any emoji (the shared picker, components/emoji-picker.tsx), or none. */}
        <div>
          <EmojiIconField id={iconId} value={icon || null} onChange={(next) => onIconChange(next ?? "")} label={t("fieldIcon")} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={pointsId}>{t("fieldPoints")}</Label>
        <Input id={pointsId} type="number" min={0} max={10000} value={points} onChange={(event) => onPointsChange(Math.max(0, Math.min(10000, Number(event.target.value) || 0)))} />
        <p className="text-xs text-muted-foreground">{t("fieldPointsHint")}</p>
      </div>
    </div>
  );
}
