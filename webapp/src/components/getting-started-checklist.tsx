"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Sparkles,
  Check,
  Circle,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useSetupState } from "@/hooks";

const COLLAPSED_KEY = "kinboard:getting_started_collapsed";

// Replaces the one-shot, dismiss-forever SetupBanner: a live checklist of the
// onboarding steps driven by /api/setup/state. Items tick off as the family
// configures things (in the wizard OR directly in settings). Collapsible —
// not destroyable — so it stays re-openable until setup is marked complete,
// at which point it disappears for good. Collapse state is per-device.
export function GettingStartedChecklist() {
  const t = useTranslations("setup.checklist");
  const { data: state } = useSetupState();
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    // On a wall display the checklist is not actionable — every step leads to
    // a setup page you would fill in from a phone — yet expanded it took the
    // most valuable block on the dashboard, above the clock and the family
    // (audit KB-13). Kiosk devices therefore start collapsed. An explicit
    // choice on this device still wins, in either direction, because the
    // collapse state is per-device and someone may genuinely want it open.
    const isKiosk = document.documentElement.hasAttribute("data-kiosk");
    setCollapsed(stored === null ? isKiosk : stored === "true");
    setReady(true);
  }, []);

  // Avoid a flash before localStorage is read, and hide once the family has
  // finished the wizard (or has no family yet).
  if (!ready || !state || state.setup_completed) return null;

  const items = [
    { key: "people", done: state.has_people, href: "/setup/people" },
    { key: "calendar", done: state.has_calendar, href: "/setup/calendar" },
    { key: "weather", done: state.has_weather_location, href: "/setup/weather" },
    { key: "homeassistant", done: state.has_home_assistant, href: "/setup/homeassistant" },
  ] as const;
  const doneCount = items.filter((i) => i.done).length;
  const total = items.length;
  const allDone = doneCount === total;

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
    });
  };

  return (
    <Card className="p-4 mb-4 border-month-primary/30 bg-month-primary/5">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-3"
        aria-expanded={!collapsed}
      >
        <Sparkles className="size-5 text-month-primary shrink-0" />
        <div className="flex-1 text-left">
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="text-xs text-muted-foreground">
            {t("progress", { done: doneCount, total })}
          </p>
        </div>
        {collapsed ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronUp className="size-4 text-muted-foreground" />
        )}
      </button>

      {!collapsed && (
        <div className="mt-3">
          <Progress value={(doneCount / total) * 100} className="h-1.5 mb-3" />
          <div className="space-y-0.5">
            {items.map((i) => (
              <Link
                key={i.key}
                href={i.href}
                className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-month-primary/10 transition-colors"
              >
                {i.done ? (
                  <Check className="size-4 text-success shrink-0" />
                ) : (
                  <Circle className="size-4 text-muted-foreground shrink-0" />
                )}
                <span
                  className={`flex-1 text-sm ${i.done ? "text-muted-foreground line-through" : ""}`}
                >
                  {t(`item_${i.key}`)}
                </span>
                {!i.done && (
                  <ArrowRight className="size-3.5 text-muted-foreground shrink-0" />
                )}
              </Link>
            ))}
          </div>
          <Button size="sm" asChild className="mt-3 w-full">
            <Link href={allDone ? "/setup/done" : "/setup"}>
              {allDone ? t("finish") : t("resume")}
              <ArrowRight className="size-4 ml-1" />
            </Link>
          </Button>
        </div>
      )}
    </Card>
  );
}
