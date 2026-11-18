"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { GraduationCap } from "lucide-react";
import { ListBox } from "@/components/layouts/list-box";
import { LessonRow, useScreensaverLessons } from "@/components/screensaver-lessons";
import type { LessonRow as LessonsRow } from "@/lib/screensaver-lessons";
import { EmptyLine, ListFrame, RowGap, useMoreLabel, type SaverWidgetProps } from "./shared";

const keyOf = (r: LessonsRow) => r.personId;
const NONE: LessonsRow[] = [];

/**
 * The children's lessons and what to bring, one row per child, as the
 * built-in screensaver lists them. Fetches its own timetables (as the
 * built-in's block does), so only a layout that places it pays for them.
 */
export function LessonsWidget(_: SaverWidgetProps) {
  const lessons = useScreensaverLessons();
  const t = useTranslations("components.screensaver");
  const tl = useTranslations("components.layouts");
  const moreLabel = useMoreLabel();
  const rows = useMemo(() => lessons?.rows ?? NONE, [lessons]);
  return (
    <ListFrame icon={GraduationCap} label={lessons?.label ?? t("lessonsToday")}>
      <ListBox
        items={rows}
        keyOf={keyOf}
        renderItem={(r) => <RowGap><LessonRow row={r} scale="box" /></RowGap>}
        empty={<EmptyLine text={tl("empty.lessons")} />}
        moreLabel={moreLabel}
      />
    </ListFrame>
  );
}
