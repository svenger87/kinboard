"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { valueBox } from "@/lib/layouts/grid";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { NotSetUp, ValueFrame, type SaverWidgetProps } from "./shared";

/**
 * In the hour before an event that starts at a time, the line the built-in
 * screensaver shows under the date ("Swimming in 20 minutes!"). Nothing
 * outside that hour, or with the line switched off in the screensaver settings.
 */
export function NextEventWidget({ item, box, editing }: SaverWidgetProps) {
  const { soon } = useScreensaverDataContext();
  const t = useTranslations("components.screensaver");
  const tl = useTranslations("components.layouts");
  const ref = useRef<HTMLParagraphElement>(null);
  const text = soon ? t(soon.child ? "nextEventChild" : "nextEventAdult", { title: soon.title, minutes: soon.minutes }) : "";
  const size = useFitToBox(ref, valueBox(box, item.text), [text]);
  // In the designer an empty box would be a mystery: say what shows there and when.
  if (!soon) return editing ? <NotSetUp text={tl("idle.nextEvent")} /> : null;
  return (
    <ValueFrame item={item} fitted={size !== null}>
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
