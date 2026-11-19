"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { valueBox } from "@/lib/layouts/grid";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { NotSetUp, ValueFrame, type SaverWidgetProps } from "./shared";

/** Which photo is showing, of how many ("3 / 45"). */
export function PhotoCountWidget({ item, box, editing }: SaverWidgetProps) {
  const { photoIndex, photoCount, photosLoading } = useScreensaverDataContext();
  const t = useTranslations("components.layouts");
  const ref = useRef<HTMLSpanElement>(null);
  const text = `${Math.max(photoIndex, 0) + 1} / ${photoCount}`;
  const size = useFitToBox(ref, valueBox(box, item.text), [text]);
  if (photoCount === 0 && photosLoading) return null;
  if (photoCount === 0) return editing ? <NotSetUp text={t("notSetUp.photoCount")} /> : null;
  return (
    <ValueFrame item={item} fitted={size !== null}>
      <span
        ref={ref}
        className="block w-fit shrink-0 whitespace-nowrap leading-tight tabular-nums text-white/40"
        style={size ? { fontSize: size } : undefined}
      >
        {text}
      </span>
    </ValueFrame>
  );
}
