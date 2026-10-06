"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Pause, Play, Timer as TimerIcon, VolumeX, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WidgetCard } from "@/components/widget-card";
import { useTimers, useStartTimer, useDismissTimer, usePauseTimer, useResumeTimer } from "@/hooks/use-timers";
import { useTimerPresets } from "@/hooks/use-timer-presets";
import { remainingSeconds, timerState } from "@/lib/timer-math";
import { applyOffset } from "@/lib/server-clock";
import { useServerClockOffset } from "@/hooks/use-server-clock";
import { useToneReady } from "@/hooks/use-tone-ready";
import { useFamilyStore } from "@/stores/family-store";

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function TimerWidget() {
  const t = useTranslations("timers");
  const { data: timers = [] } = useTimers();
  const start = useStartTimer();
  const dismiss = useDismissTimer();
  const pause = usePauseTimer();
  const resume = useResumeTimer();
  // The family's own (Settings → Widgets → Timers). 3, 5, 10 and 15 until
  // they have been read, and if reading them fails: the presets are the only
  // way a screen starts a timer, so the row is never empty.
  const { presets } = useTimerPresets();

  const offsetMs = useServerClockOffset();
  const [now, setNow] = useState(() => new Date());
  // The alarm itself sounds from TimerAlarm, on every page of a wall display.
  // This only says when it can't: a panel nobody has touched since it loaded.
  const { device } = useFamilyStore();
  const toneReady = useToneReady();

  // A preset tap that fails otherwise does nothing visible: the button just
  // sits there, no row appears, no error either. Same shape as the other
  // widgets' mutation failures (e.g. shopping-widget's toggle) — catch it and
  // say so.
  const handlePreset = async (minutes: number) => {
    try {
      await start.mutateAsync({ duration_seconds: minutes * 60 });
    } catch {
      toast.error(t("startFailed"));
    }
  };


  // Pause and resume answer a tap at once, or say they could not.
  const togglePause = async (id: string, paused: boolean) => {
    try {
      await (paused ? resume : pause).mutateAsync(id);
    } catch {
      toast.error(t(paused ? "resumeFailed" : "pauseFailed"));
    }
  };

  // One clock for every ring. Only runs while something is counting.
  const hasRunning = timers.some((x) => timerState(x, applyOffset(now, offsetMs)) === "running");
  useEffect(() => {
    if (!hasRunning) return;
    // Read as it starts, not a second later: while nothing counted the clock
    // stood still, and a timer resumed after a pause read the time it had
    // plus the whole pause until the first tick.
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [hasRunning]);

  const serverNow = applyOffset(now, offsetMs);

  const visible = useMemo(
    () => timers.filter((x) => timerState(x, serverNow) !== "dismissed"),
    [timers, serverNow],
  );
  const soundOff = (device?.is_kiosk ?? false) && !toneReady && visible.length > 0;

  return (
    <WidgetCard
      title={t("title")}
      icon={TimerIcon}
      // In the header, where it takes no room of its own: the touch that turns
      // the sound on also hides it, and anything that moved under that finger
      // would lose the tap it started.
      headerRight={
        soundOff ? (
          <Badge variant="neutral" className="gap-1" title={t("soundOff")} aria-label={t("soundOff")}>
            <VolumeX className="size-3.5" aria-hidden="true" />
            {t("soundOffShort")}
          </Badge>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {visible.map((timer) => {
          const state = timerState(timer, serverNow);
          const left = remainingSeconds(timer, serverNow);
          return (
            <div
              key={timer.id}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                state === "finished" ? "border-destructive bg-destructive/10" : "border-border"
              }`}
            >
              {/* "Paused" under the time, where a narrow card can't cut it off
                  the way it cut "Pasta · Paused"; the label stays the row's
                  own child, as e2e/timer-widget-layout.spec.ts finds rows by it. */}
              <span className="flex shrink-0 flex-col leading-tight">
                <span className={`font-mono text-lg tabular-nums ${state === "paused" ? "text-muted-foreground" : ""}`}>
                  {state === "finished" ? t("finished") : mmss(left)}
                </span>
                {state === "paused" && (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("paused")}</span>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {timer.label}
              </span>
              {(state === "running" || state === "paused") && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="min-h-[44px] min-w-[44px]"
                  aria-label={state === "paused" ? t("resume") : t("pause")}
                  onClick={() => void togglePause(timer.id, state === "paused")}
                >
                  {state === "paused" ? <Play className="size-4" /> : <Pause className="size-4" />}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="min-h-[44px] min-w-[44px]"
                aria-label={state === "finished" ? t("dismiss") : t("stop")}
                onClick={() => dismiss.mutate(timer.id)}
              >
                <X className="size-4" />
              </Button>
            </div>
          );
        })}

        {/*
          Present when idle, deliberately unlike the media widget. Media has
          another origin — you start playback on the speaker — so a widget that
          hides when idle still leaves a way. A timer has no origin but this
          screen, so hiding it here would mean it could never be used.
        */}
        <div className="flex flex-wrap gap-2">
          {presets.map((minutes) => (
            <Button
              key={minutes}
              variant="outline"
              className="min-h-[44px]"
              onClick={() => void handlePreset(minutes)}
            >
              {t("preset", { minutes })}
            </Button>
          ))}
        </div>
      </div>
    </WidgetCard>
  );
}
