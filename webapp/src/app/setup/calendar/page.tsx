"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { WizardProgress } from "@/components/setup/wizard-progress";
import { WizardStepFooter } from "@/components/setup/wizard-step-footer";
import { useCreateIcsCalendar } from "@/hooks";

interface TestResult {
  ok: boolean;
  eventCount?: number;
  error?: string;
}

const DEFAULT_COLOR = "#3b82f6";

export default function SetupCalendarPage() {
  const t = useTranslations("setup.calendar");
  const createIcs = useCreateIcsCalendar();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const handleTest = async () => {
    if (!url.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/calendar/test-ics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      setTestResult((await res.json()) as TestResult);
    } catch {
      setTestResult({ ok: false, error: "Network error" });
    } finally {
      setTesting(false);
    }
  };

  const handleNext = async () => {
    // Nothing entered → behave like Skip; the footer navigates forward.
    if (!url.trim()) return;
    try {
      await createIcs.mutateAsync({
        name: name.trim() || t("defaultName"),
        color: DEFAULT_COLOR,
        ics_url: url.trim(),
        person_id: null,
        is_holidays: false,
        is_waste_collection: false,
      });
    } catch (err) {
      console.error("setup/calendar: save failed:", err);
      toast.error(t("saveError"));
      // Re-throw so the footer keeps the user on this step to retry.
      throw err;
    }
  };

  return (
    <>
      <WizardProgress current="calendar" />
      <GlassCard className="p-6 md:p-8">
        <h1 className="text-2xl font-display tracking-tight mb-2">{t("title")}</h1>
        <p className="text-muted-foreground text-sm mb-6">{t("description")}</p>

        {/* Google Calendar — OAuth connect lives in settings */}
        <div className="rounded-lg border border-border/60 p-4 mb-6 flex items-start gap-3">
          <div className="flex-1">
            <p className="font-medium text-sm">{t("googleTitle")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t("googleBody")}</p>
          </div>
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <Link href="/settings/google">{t("googleButton")}</Link>
          </Button>
        </div>

        {/* iCal feed — added in-wizard */}
        <p className="text-sm font-medium mb-3">{t("icsTitle")}</p>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="setup-cal-name">{t("nameLabel")}</Label>
            <Input
              id="setup-cal-name"
              placeholder={t("namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="setup-cal-url">{t("urlLabel")}</Label>
            <Input
              id="setup-cal-url"
              placeholder={t("urlPlaceholder")}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setTestResult(null);
              }}
            />
            <p className="text-xs text-muted-foreground">{t("urlHint")}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={!url.trim() || testing}
              className="self-start"
            >
              {testing ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  {t("testingLabel")}
                </>
              ) : (
                t("testButton")
              )}
            </Button>
            {testResult && (
              <span
                className={`text-sm flex items-center gap-1 ${
                  testResult.ok ? "text-success" : "text-destructive"
                }`}
              >
                {testResult.ok ? (
                  <Check className="size-4" />
                ) : (
                  <AlertCircle className="size-4" />
                )}
                {testResult.ok
                  ? testResult.eventCount === 0
                    ? t("testNoEvents")
                    : t("testSuccess", { count: testResult.eventCount ?? 0 })
                  : t("testFailed", { error: testResult.error ?? "Unknown" })}
              </span>
            )}
          </div>
        </div>
      </GlassCard>

      <WizardStepFooter
        backHref="/setup/people"
        nextHref="/setup/homeassistant"
        onNextClick={handleNext}
        disabled={createIcs.isPending}
      />
    </>
  );
}
