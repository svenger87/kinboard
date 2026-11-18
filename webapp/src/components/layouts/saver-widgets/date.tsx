"use client";

import { useRef } from "react";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { ValueFrame, type SaverWidgetProps } from "./shared";

/** Today's date, written out ("Mittwoch, 18. November"), fitted to the box. */
export function DateWidget({ box }: SaverWidgetProps) {
  const { formattedDate } = useScreensaverDataContext();
  const ref = useRef<HTMLParagraphElement>(null);
  const size = useFitToBox(ref, box, [formattedDate]);
  return (
    <ValueFrame fitted={size !== null}>
      <p
        ref={ref}
        className="block w-fit shrink-0 whitespace-nowrap font-light leading-tight tracking-wide text-white/60"
        style={size ? { fontSize: size } : undefined}
      >
        {formattedDate}
      </p>
    </ValueFrame>
  );
}
