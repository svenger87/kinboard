"use client";

import { useRef } from "react";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { valueBox } from "@/lib/layouts/grid";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { ValueFrame, type SaverWidgetProps } from "./shared";

/** The time, as large as the box allows: the built-in screensaver's clock digits. */
export function ClockWidget({ item, box }: SaverWidgetProps) {
  const { hours, minutes } = useScreensaverDataContext();
  const ref = useRef<HTMLDivElement>(null);
  const size = useFitToBox(ref, valueBox(box, item.text), [hours, minutes]);
  return (
    <ValueFrame fitted={size !== null}>
      <div ref={ref} className="flex w-fit shrink-0 items-baseline" style={size ? { fontSize: size } : undefined}>
        <span className="font-display font-light text-white clock-display tracking-tighter leading-none">{hours}</span>
        <span className="font-display font-light text-white/30 mx-[0.03em] leading-none">:</span>
        <span className="font-display font-light text-white clock-display tracking-tighter leading-none">{minutes}</span>
      </div>
    </ValueFrame>
  );
}
