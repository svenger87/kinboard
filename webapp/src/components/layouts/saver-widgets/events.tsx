"use client";

import { useTranslations } from "next-intl";
import { Calendar } from "lucide-react";
import { ListBox } from "@/components/layouts/list-box";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { EventRow, useEventWhen, type ScreensaverEvent } from "@/components/screensaver-rows";
import { EmptyLine, ListFrame, RowGap, useMoreLabel, type SaverWidgetProps } from "./shared";

const keyOf = (e: ScreensaverEvent) => e.id;

/** The coming week's events, holidays among them, as many as fit the box, then "+n more". */
export function EventsWidget(_: SaverWidgetProps) {
  const { eventsAhead } = useScreensaverDataContext();
  const t = useTranslations("components.screensaver");
  const tl = useTranslations("components.layouts");
  const when = useEventWhen();
  const moreLabel = useMoreLabel();
  return (
    <ListFrame icon={Calendar} label={t("eventsLabel")}>
      <ListBox
        items={eventsAhead}
        keyOf={keyOf}
        renderItem={(e) => <RowGap><EventRow event={e} when={when(e)} scale="box" /></RowGap>}
        empty={<EmptyLine text={tl("empty.events")} />}
        moreLabel={moreLabel}
      />
    </ListFrame>
  );
}
