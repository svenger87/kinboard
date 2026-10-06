"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSaveTimerPresets, useTimerPresets } from "@/hooks/use-timer-presets";
import {
  MAX_TIMER_PRESETS,
  MAX_TIMER_PRESET_MINUTES,
  isTimerPresetMinutes,
  withTimerPreset,
  withoutTimerPreset,
} from "@/lib/timer-presets";

/**
 * Settings → Widgets → Timers: the buttons the timer widget offers. Like the
 * switches around it, every change is saved at once, for every screen of the
 * family. The last preset can't be removed: the widget is the only way a
 * screen starts a timer.
 */
export function TimerPresetsEditor({ disabled }: { disabled: boolean }) {
  const t = useTranslations("settings.widgets");
  const tTimers = useTranslations("timers");
  const { presets, custom, isLoading } = useTimerPresets();
  const save = useSaveTimerPresets();
  const [draft, setDraft] = useState("");

  // The input itself stays usable while a save runs, so the keyboard stays
  // open between two additions; only what would write is held back.
  const busy = disabled || isLoading || save.isPending;
  const typed = draft.trim() !== "";
  const minutes = Number(draft);
  const valid = typed && isTimerPresetMinutes(minutes);
  const already = valid && presets.includes(minutes);
  const full = presets.length >= MAX_TIMER_PRESETS;

  const store = async (next: number[] | null) => {
    try {
      await save.mutateAsync(next);
      return true;
    } catch {
      toast.error(t("timersPresetsSaveFailed"));
      return false;
    }
  };

  const add = async () => {
    if (busy || !valid || already || full) return;
    const added = draft;
    // Emptied only if it still holds what was added: the next time may
    // already be typed while this one saves.
    if (await store(withTimerPreset(presets, minutes))) setDraft((now) => (now === added ? "" : now));
  };

  return (
    <div className="mt-3 border-t border-border/40 pt-3" data-testid="timer-presets">
      <p className="text-sm font-medium">{t("timersPresetsLabel")}</p>
      <p className="text-xs text-muted-foreground">{t("timersPresetsDescription", { max: MAX_TIMER_PRESETS })}</p>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label={t("timersPresetsLabel")}>
        {presets.map((preset) => (
          <li key={preset} className="flex items-center rounded-full border border-border pl-3 text-sm">
            {tTimers("preset", { minutes: preset })}
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label={t("timersPresetsRemove", { minutes: preset })}
              disabled={busy || presets.length === 1}
              onClick={() => void store(withoutTimerPreset(presets, preset))}
            >
              <X className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-start gap-2">
        {full ? (
          <p className="py-3 text-xs text-muted-foreground">{t("timersPresetsFull", { max: MAX_TIMER_PRESETS })}</p>
        ) : (
          <div>
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void add();
              }}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_TIMER_PRESET_MINUTES}
                step={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t("timersPresetsMinutes")}
                aria-label={t("timersPresetsAddLabel")}
                className="h-11 w-28"
                disabled={disabled}
              />
              <Button type="submit" variant="outline" disabled={busy || !valid || already}>
                {t("timersPresetsAdd")}
              </Button>
            </form>
            {/* Under the box, not under Reset, which wraps below it on a phone. */}
            {typed && !valid && (
              <p className="mt-1 text-xs text-destructive">{t("timersPresetsRange", { max: MAX_TIMER_PRESET_MINUTES })}</p>
            )}
            {already && <p className="mt-1 text-xs text-muted-foreground">{t("timersPresetsAlready", { minutes })}</p>}
          </div>
        )}
        {custom && (
          <Button variant="ghost" className="ml-auto" disabled={busy} onClick={() => void store(null)}>
            {t("timersPresetsReset")}
          </Button>
        )}
      </div>
    </div>
  );
}
