"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Timer as TimerIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WidgetCard } from "@/components/widget-card";
import { useTimers, useStartTimer, useDismissTimer } from "@/hooks/use-timers";
import { remainingSeconds, timerState } from "@/lib/timer-math";
import { offsetFromDateHeader, applyOffset } from "@/lib/server-clock";
import { unlockTone, playTone } from "@/lib/timer-tone";

const PRESETS = [3, 5, 10, 15];

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function TimerWidget() {
  const t = useTranslations("timers");
  const { data: timers = [] } = useTimers();
  const start = useStartTimer();
  const dismiss = useDismissTimer();

  const [offsetMs, setOffsetMs] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const rung = useRef<Set<string>>(new Set());

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

  /*
    Measure the clock offset once. `started_at` comes from the server and `now`
    from this browser, so a panel two minutes fast would end its timers two
    minutes early. Any response will do — every one carries a Date header —
    so this costs a HEAD request, not an endpoint.
  */
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/health", { method: "HEAD" })
      .then((res) => {
        const measured = offsetFromDateHeader(res.headers.get("date"), new Date());
        if (!cancelled && measured !== null) setOffsetMs(measured);
      })
      .catch(() => {
        // Unmeasured: fall back to the browser's own clock, which is right on
        // most devices and only slightly wrong on the rest.
      });
    return () => { cancelled = true; };
  }, []);

  // One clock for every ring. Only runs while something is counting.
  const hasRunning = timers.some((x) => timerState(x, applyOffset(now, offsetMs)) === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  const serverNow = applyOffset(now, offsetMs);

  const visible = useMemo(
    () => timers.filter((x) => timerState(x, serverNow) !== "dismissed"),
    [timers, serverNow],
  );
  const finished = visible.filter((x) => timerState(x, serverNow) === "finished");

  /*
    Ring once per timer, and only on a kiosk. A phone in a pocket should not
    beep from an open tab — its channel is the push, and without this rule
    standing in the kitchen holding your phone means the timer goes off twice.
  */
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!document.documentElement.hasAttribute("data-kiosk")) return;
    const fresh = finished.filter((x) => !rung.current.has(x.id));
    if (fresh.length === 0) return;
    for (const x of fresh) rung.current.add(x.id);
    // One tone however many ended together, not a chord.
    playTone();
  }, [finished]);

  return (
    <WidgetCard title={t("title")} icon={TimerIcon}>
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
              <span className="font-mono text-lg tabular-nums">
                {state === "finished" ? t("finished") : mmss(left)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {timer.label}
              </span>
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
        <div className="flex flex-wrap gap-2" onPointerDown={unlockTone}>
          {PRESETS.map((minutes) => (
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
