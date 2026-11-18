"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { ValueFrame, type SaverWidgetProps } from "./shared";

/**
 * In the hour before an event that starts at a time, the line the built-in
 * screensaver shows under the date ("Swimming in 20 minutes!"). Nothing
 * outside that hour, or with the line switched off in the screensaver settings.
 */
export function NextEventWidget({ box }: SaverWidgetProps) {
  const { soon } = useScreensaverDataContext();
  const t = useTranslations("components.screensaver");
  const ref = useRef<HTMLParagraphElement>(null);
  const text = soon ? t(soon.child ? "nextEventChild" : "nextEventAdult", { title: soon.title, minutes: soon.minutes }) : "";
  const size = useFitToBox(ref, box, [text]);
  if (!soon) return null;
  return (
    <ValueFrame fitted={size !== null}>
      <p
        ref={ref}
        className="block w-fit shrink-0 whitespace-nowrap rounded-[0.4em] bg-white/15 px-[0.6em] py-[0.15em] font-semibold text-white"
        style={size ? { fontSize: size } : undefined}
        data-child={soon.child ? "true" : "false"}
      >
        {text}
      </p>
    </ValueFrame>
  );
}
