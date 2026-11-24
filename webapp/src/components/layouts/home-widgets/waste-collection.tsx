"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { useHomeDataContext } from "@/components/layouts/home-data-context";
import { WASTE_PRESENTATION, useWasteDayLabel, useWasteLabels, wasteCollections } from "@/components/widgets/waste-collection-widget";
import { useTimeFormat } from "@/hooks/use-time-format";
import { personText, personTint } from "@/lib/person-color";
import { HOME_ROW, HomeEmptyLine, HomeList } from "./list-shared";
import type { HomeWidgetProps } from "./shared";
import { HomeCard } from "./frame";

type Entry = ReturnType<typeof wasteCollections>[number];

const keyOf = (e: Entry) => e.id;

/**
 * The next collection of each bin in Home's fortnight of events, soonest
 * first, as many as fit. "+n" and the title open /calendar, as the card's
 * chevron does.
 */
export function WasteCollectionHomeWidget({ editing }: HomeWidgetProps) {
  const t = useTranslations("wasteCollectionWidget");
  const { formatTime } = useTimeFormat();
  const { events, today } = useHomeDataContext();
  const labels = useWasteLabels();
  const dayLabel = useWasteDayLabel();
  const entries = useMemo(() => wasteCollections(events, today), [events, today]);

  const renderItem = (e: Entry) => {
    const presentation = WASTE_PRESENTATION[e.wasteType.id];
    const Icon = presentation.icon;
    const urgent = e.daysUntil <= 1;
    const when = dayLabel(e.date, e.daysUntil);
    return (
      <>
        <div
          className={HOME_ROW}
          style={urgent ? { borderLeft: `4px solid ${presentation.color}` } : undefined}
          aria-label={t("itemAria", { label: labels[e.wasteType.id], when })}
        >
          <span className="shrink-0 rounded-[0.4em] p-[0.35em]" style={{ backgroundColor: personTint(presentation.color, 84), color: personText(presentation.color) }}>
            <Icon className="size-[0.9em]" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-words home-body font-medium leading-snug">{labels[e.wasteType.id]}</p>
            <p className="home-meta tabular-nums text-muted-foreground">
              {when}
              {e.date.getHours() > 0 && ` ${formatTime(e.date)}`}
            </p>
          </div>
          <span
            className={`shrink-0 home-meta tabular-nums ${urgent ? "rounded-full bg-warning/15 px-[0.6em] py-[0.15em] font-semibold text-warning" : "text-muted-foreground"}`}
          >
            {urgent ? (e.daysUntil === 0 ? t("todayBadge") : t("tomorrowBadge")) : t("daysSuffix", { count: e.daysUntil })}
          </span>
        </div>
      </>
    );
  };

  return (
    <HomeCard list testId="home-widget-wasteCollection" icon={Trash2} title={t("title")} href="/calendar" editing={editing}>
      <HomeList items={entries} keyOf={keyOf} renderItem={renderItem} empty={<HomeEmptyLine text={t("emptyState")} />} href="/calendar" />
    </HomeCard>
  );
}
