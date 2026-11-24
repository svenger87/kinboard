"use client";

import { useMemo, useRef } from "react";
import { Pause, Play, Timer as TimerIcon, VolumeX, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { mmss, useTimerControls } from "@/components/widgets/timer-widget";
import { remainingSeconds, timerState } from "@/lib/timer-math";
import type { HomeWidgetProps } from "./shared";
import { HomeCard, HomeCardHeader } from "./frame";
import { TOUCH, useShrinkStep } from "./rest-shared";

interface Step {
  header: boolean;
  /** Timers shown; the rest are counted in a "+n" line while `more` is on. */
  timers: number;
  more: boolean;
  presets: boolean;
}

/**
 * The timers in a box (RFC-022 §3.1, fixed): each running, paused or
 * finished timer with its pause and stop buttons, then a row of presets to
 * start one. The buttons stay 48px at every text size (§3.3); a box too
 * small for them shows fewer -- timers beyond the first (counted in "+n"),
 * then the presets while a timer runs, and only then the title row. A preset
 * row shows as many presets as fit on one line. The logic is the card's
 * (useTimerControls), its one clock ticking only while something counts.
 */
export function TimersHomeWidget({ box }: HomeWidgetProps) {
  const t = useTranslations("timers");
  const tl = useTranslations("components.layouts");
  const { presets, handlePreset, togglePause, dismiss, serverNow, visible, soundOff } = useTimerControls();

  const count = visible.length;
  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [
      { header: true, timers: count, more: true, presets: true },
    ];
    for (let k = count - 1; k >= 1; k--) out.push({ header: true, timers: k, more: true, presets: true });
    if (count > 0) {
      out.push({ header: true, timers: 1, more: true, presets: false });
      // The title row only now, the screen's size in every box (frame.tsx): a box of one row holds a timer, not both.
      out.push({ header: false, timers: 1, more: true, presets: false });
      // The first timer alone, with its buttons: what a box of one row is for.
      out.push({ header: false, timers: 1, more: false, presets: false });
    }
    return out;
  }, [count]);

  // Fitted again when the timers or their states change, not every second.
  const shape = visible.map((x) => `${x.id}:${timerState(x, serverNow)}`).join();
  const ref = useRef<HTMLDivElement>(null);
  const index = useShrinkStep(ref, steps.length, [box.width, box.height, shape, presets.join(), soundOff]);
  const step = steps[Math.min(index, steps.length - 1)];
  const shown = visible.slice(0, step.timers);
  const more = count - shown.length;

  return (
    <HomeCard ref={ref} testId="home-timers" step={index} className="gap-[0.4em]">
      {step.header && (
        <HomeCardHeader
          icon={TimerIcon}
          title={t("title")}
          right={
            soundOff ? (
              <span className="flex items-center gap-[0.25em] rounded-full bg-muted px-[0.5em] py-[0.1em] home-meta" title={t("soundOff")} aria-label={t("soundOff")}>
                <VolumeX className="size-[1em]" aria-hidden="true" />
                {t("soundOffShort")}
              </span>
            ) : undefined
          }
        />
      )}
      {shown.map((timer) => {
        const state = timerState(timer, serverNow);
        const left = remainingSeconds(timer, serverNow);
        return (
          <div
            key={timer.id}
            className={`flex shrink-0 items-center gap-1 rounded-xl border pl-2 ${
              state === "finished" ? "border-destructive bg-destructive/10" : "border-border"
            }`}
            data-testid="home-timer-row"
            data-state={state}
          >
            <span className="flex shrink-0 flex-col leading-tight">
              <span className={`font-mono home-value tabular-nums ${state === "paused" ? "text-muted-foreground" : ""}`}>
                {state === "finished" ? t("finished") : mmss(left)}
              </span>
              {state === "paused" && <span className="home-label font-medium uppercase tracking-wide text-muted-foreground">{t("paused")}</span>}
            </span>
            <span className="min-w-0 flex-1 truncate home-meta text-muted-foreground">{timer.label}</span>
            {(state === "running" || state === "paused") && (
              <Button
                variant="ghost"
                size="icon"
                className={`${TOUCH} shrink-0`}
                aria-label={state === "paused" ? t("resume") : t("pause")}
                onClick={() => void togglePause(timer.id, state === "paused")}
              >
                {state === "paused" ? <Play className="size-5" /> : <Pause className="size-5" />}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className={`${TOUCH} shrink-0`}
              aria-label={state === "finished" ? t("dismiss") : t("stop")}
              onClick={() => dismiss.mutate(timer.id)}
            >
              <X className="size-5" />
            </Button>
          </div>
        );
      })}
      {step.more && more > 0 && (
        <p className="shrink-0 home-meta font-medium text-muted-foreground" data-testid="box-more">
          {tl("more", { count: more })}
        </p>
      )}
      {step.presets && (
        // One line of presets: those that wrap onto a second line are cut off whole, never in half.
        <div className="flex h-[48px] shrink-0 flex-wrap gap-[0.4em] overflow-hidden" data-testid="home-timer-presets">
          {presets.map((minutes) => (
            <Button key={minutes} variant="outline" className={`${TOUCH} px-[0.7em] home-body`} onClick={() => void handlePreset(minutes)}>
              {t("preset", { minutes })}
            </Button>
          ))}
        </div>
      )}
    </HomeCard>
  );
}
