"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";

/**
 * Sample cards for a festival preview off Home (Settings, the gallery): the
 * same grid hook and a Tasks card among them, so the dressing that hangs on
 * Home's cards shows here too. Without them a festival with no visitor
 * (St Nicholas's boot) previews as the faint wash alone. `narrow` (Settings)
 * is two columns at most and leaves out the reviewer's note on each card.
 */
export function FestivalSampleCards({ className = "", testId = "gallery-card", narrow = false }: { className?: string; testId?: string; narrow?: boolean }) {
  const t = useTranslations("settings.festivalGallery");
  return (
    <section aria-label={t("sampleCards")} className={`festival-grid relative z-[1] grid grid-cols-1 gap-4 sm:grid-cols-2 ${narrow ? "" : "lg:grid-cols-4"} md:gap-6 ${className}`}>
      {["one", "two", "tasks", "four"].map((card) => (
        <Card key={card} className={`p-4 ${card === "tasks" ? "festival-tasks" : ""}`} data-testid={`${testId}-${card}`}>
          <h3 className="font-display text-base font-semibold">{card === "tasks" ? t("sampleTasks") : t("sampleTitle")}</h3>
          {!narrow && <p className="mt-2 text-sm text-muted-foreground">{t("sampleText")}</p>}
        </Card>
      ))}
    </section>
  );
}
