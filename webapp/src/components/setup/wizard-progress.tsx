"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const STEPS = ["people", "calendar", "homeassistant", "weather", "done"] as const;
export type WizardStep = (typeof STEPS)[number];

export function WizardProgress({ current }: { current: WizardStep }) {
  const t = useTranslations("setup");
  const idx = STEPS.indexOf(current);
  const total = STEPS.length;

  return (
    <div className="w-full max-w-2xl mx-auto mb-8">
      <p className="text-kiosk-label text-center mb-3">
        {t("stepLabel", { current: idx + 1, total })}
      </p>
      <div className="flex gap-2">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={cn(
              "h-2 flex-1 rounded-full transition-colors",
              i <= idx ? "bg-primary" : "bg-secondary",
            )}
          />
        ))}
      </div>
    </div>
  );
}

export { STEPS };
