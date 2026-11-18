"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Calendar } from "lucide-react";
import { ListBox } from "@/components/layouts/list-box";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { EventRow, useEventWhen, type ScreensaverEvent } from "@/components/screensaver-rows";
import { EmptyLine, ListFrame, RowGap, useMoreLabel, type SaverWidgetProps } from "./shared";

const keyOf = (e: ScreensaverEvent) => e.id;

/** Public and school holidays in the coming week, drawn as the events list draws them. */
export function HolidaysWidget(_: SaverWidgetProps) {
  const { eventsAhead } = useScreensaverDataContext();
  const tl = useTranslations("components.layouts");
  const when = useEventWhen();
  const moreLabel = useMoreLabel();
  const holidays = useMemo(() => eventsAhead.filter((e) => e.holiday), [eventsAhead]);
  return (
    <ListFrame icon={Calendar} label={tl("holidaysLabel")}>
      <ListBox
        items={holidays}
        keyOf={keyOf}
        renderItem={(e) => <RowGap><EventRow event={e} when={when(e)} scale="box" /></RowGap>}
        empty={<EmptyLine text={tl("empty.holidays")} />}
        moreLabel={moreLabel}
      />
    </ListFrame>
  );
}
