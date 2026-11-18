"use client";

import { useTranslations } from "next-intl";
import { Cake } from "lucide-react";
import { ListBox } from "@/components/layouts/list-box";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { BirthdayRow, type ScreensaverBirthday } from "@/components/screensaver-rows";
import { EmptyLine, ListFrame, RowGap, useMoreLabel, type SaverWidgetProps } from "./shared";

const keyOf = (b: ScreensaverBirthday) => b.id;

/** Birthdays in the next 30 days, as many as fit the box, then "+n more". */
export function BirthdaysWidget(_: SaverWidgetProps) {
  const { birthdaysAhead } = useScreensaverDataContext();
  const t = useTranslations("components.screensaver");
  const tl = useTranslations("components.layouts");
  const moreLabel = useMoreLabel();
  return (
    <ListFrame icon={Cake} label={t("birthdaysLabel")}>
      <ListBox
        items={birthdaysAhead}
        keyOf={keyOf}
        renderItem={(b) => <RowGap><BirthdayRow birthday={b} scale="box" /></RowGap>}
        empty={<EmptyLine text={tl("empty.birthdays")} />}
        moreLabel={moreLabel}
      />
    </ListFrame>
  );
}
