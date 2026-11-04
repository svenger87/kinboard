"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { FestivalVisitor } from "@/components/weather-effects";
import { FestivalSampleCards } from "@/components/festival-sample-cards";
import { CreatureAvatar } from "@/components/pocket-money/creature-avatar";
import { useHolidayRegion } from "@/hooks/use-holiday-region";
import { useMotion } from "@/hooks/use-motion";
import { startFestivalPreview, stopFestivalPreview, useFestival } from "@/hooks/use-festival";
import { FESTIVALS, commonFestivals, festivalDates, type FestivalId } from "@/lib/festivals";
import { FESTIVAL_KITS } from "@/lib/festivals/kits";
import type { Hsl } from "@/lib/festivals/kit";
import { withFestivalOutfit } from "@/lib/festival-settings";

/**
 * The festival gallery (RFC-020): every festival, drawn or not, for review.
 * Not in the settings list; reached at /settings/festival-gallery. Each
 * drawn festival previews here on demand -- its visitor flying over this
 * page, its dressing on the sample cards below, its wash, its outfit on a
 * creature -- at any of its stages, whatever the date, as
 * `?festival-preview=<id>` does on Home. A draft (drawn, not offered yet)
 * previews too: that is what the gallery is for.
 *
 * What moves still follows this screen's Animations switch, as everywhere:
 * with Reduced there is no visitor, with Off no dressing either.
 */
export default function FestivalGalleryPage() {
  const t = useTranslations("settings.festivalGallery");
  const theme = useTranslations("settings.theme");
  const { region } = useHolidayRegion();
  const motion = useMotion();
  const shown = useFestival();
  const previewing = shown?.preview ? shown.id : null;
  // A fresh scene on "Fly now": its first pass comes at once.
  const [flight, setFlight] = useState(0);
  const year = new Date().getFullYear();
  const common = useMemo(() => new Set(commonFestivals(region)), [region]);
  // A preview started here ends when the page does.
  useEffect(() => () => stopFestivalPreview(), []);

  const preview = (id: FestivalId, stage?: string | null) => {
    startFestivalPreview(id, undefined, stage);
    setFlight((n) => n + 1);
  };

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset" data-testid="festival-gallery">
      {previewing && <FestivalVisitor key={`${previewing}-${flight}`} />}
      <div className="relative z-10 max-w-5xl mx-auto">
        <PageHeader icon={PartyPopper} title={t("title")} subtitle={t("subtitle")} className="mb-6" />
        <p className="mb-4 text-sm text-muted-foreground">{motion === "full" ? t("motionOn") : motion === "reduced" ? t("motionReduced") : t("motionOff")}</p>

        {/* The cards the dressing hangs on, as on Home. */}
        <FestivalSampleCards className="mb-10 mt-8" />

        <ul className="grid gap-4 md:grid-cols-2">
          {FESTIVALS.map((id) => {
            const kit = FESTIVAL_KITS[id];
            const windows = [...festivalDates(id, year, region), ...festivalDates(id, year + 1, region)].slice(0, 2);
            const active = previewing === id;
            return (
              <li key={id}>
                <Card className={`h-full p-4 ${active ? "ring-2 ring-primary" : ""}`} data-testid={`gallery-${id}`} data-drawn={kit ? (kit.draft ? "draft" : "yes") : "no"}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-display text-lg font-semibold">{theme(`festivalName.${id}` as never)}</h2>
                      <p className="text-xs text-muted-foreground">{theme(`festivalWhen.${id}` as never)}</p>
                    </div>
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs">
                      {kit ? (kit.draft ? t("draft") : t("drawn")) : t("notDrawn")}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">{t("dates")}</dt>
                    <dd data-testid={`gallery-${id}-dates`}>{windows.length ? windows.map((w) => (w.start === w.end ? w.start : `${w.start} – ${w.end}`)).join(", ") : t("noDates")}</dd>
                    <dt className="text-muted-foreground">{t("preTicked")}</dt>
                    <dd>{common.has(id) ? t("yes") : t("no")}</dd>
                    {kit && (
                      <>
                        <dt className="text-muted-foreground">{t("visitor")}</dt>
                        <dd>{kit.visitor ? kit.visitor.archetype : t("none")}</dd>
                        <dt className="text-muted-foreground">{t("wash")}</dt>
                        <dd className="flex items-center gap-3">
                          <Swatches label={t("light")} colours={kit.wash.light} />
                          <Swatches label={t("dark")} colours={kit.wash.dark} />
                        </dd>
                        <dt className="text-muted-foreground">{t("outfit")}</dt>
                        <dd>{kit.outfit.length ? kit.outfit.map((o) => `${o.item} (${o.slot})`).join(", ") : t("none")}</dd>
                      </>
                    )}
                  </dl>
                  {kit && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {kit.outfit.length > 0 && (
                        <CreatureAvatar
                          species="dragon"
                          tier={5}
                          style="storybook"
                          size={72}
                          animated={false}
                          look={withFestivalOutfit({}, id)}
                          label={`${theme(`festivalName.${id}` as never)}: ${t("outfit")}`}
                        />
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={active ? "outline" : "default"}
                          aria-pressed={active}
                          onClick={() => (active ? stopFestivalPreview() : preview(id))}
                          data-testid={`gallery-preview-${id}`}
                        >
                          {active ? t("stop") : t("preview")}
                        </Button>
                        {active && kit.visitor && (
                          <Button type="button" size="sm" variant="ghost" onClick={() => setFlight((n) => n + 1)} data-testid={`gallery-fly-${id}`}>
                            {t("flyNow")}
                          </Button>
                        )}
                        {(kit.stages ?? []).map((stage) => (
                          <Button
                            key={stage}
                            type="button"
                            size="sm"
                            variant={active && shown?.stage === stage ? "outline" : "ghost"}
                            onClick={() => preview(id, stage)}
                            data-testid={`gallery-stage-${id}-${stage}`}
                          >
                            {t("stage", { stage })}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}

function Swatches({ label, colours }: { label: string; colours: [Hsl, Hsl] }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${label}: ${colours.join(" / ")}`}>
      <span className="text-muted-foreground">{label}</span>
      {colours.map((c) => (
        <span key={c} className="inline-block size-4 rounded-full border" style={{ background: `hsl(${c})` }} />
      ))}
    </span>
  );
}
