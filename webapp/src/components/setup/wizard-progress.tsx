"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { WizardStep } from "@/lib/first-run";
import { useWizardNav } from "@/components/setup/use-wizard-nav";

export type { WizardStep };

export function WizardProgress({ current }: { current: WizardStep }) {
  const t = useTranslations("setup");
  const { steps } = useWizardNav(current);
  const idx = Math.max(0, steps.indexOf(current));
  const total = steps.length;

  return (
    <div className="w-full max-w-2xl mx-auto mb-8" data-testid="wizard-progress" data-step={current}>
      <p className="text-kiosk-label text-center mb-3">
        {t("stepLabel", { current: idx + 1, total })}
      </p>
      <div className="flex gap-2">
        {steps.map((s, i) => (
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
