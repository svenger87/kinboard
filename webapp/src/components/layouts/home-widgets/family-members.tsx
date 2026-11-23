"use client";

import { useMemo, useRef } from "react";
import { addDays, endOfDay } from "date-fns";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { eventsOverlapping } from "@/lib/home-data";
import { useHomeDataContext } from "@/components/layouts/home-data-context";
import { FamilyMembers } from "@/components/widgets/family-members";
import { useBoxFontSize } from "./clock";
import type { HomeWidgetProps } from "./shared";

/**
 * Room a member needs, in em of the text size, with the name and counts
 * under the avatar: avatar 2.6, gaps, a name line and a counts line.
 */
const STACKED_EM = 5;

/**
 * The family members in a box (RFC-022 §3.2): the avatars with their counts,
 * a fixed arrangement fitted to the box. With room for it the name and
 * counts sit under each avatar, as on the built-in Home; in a flat box they
 * sit beside it. Drawn at the box's text size and only made smaller when the
 * box is too small; an avatar, and so a member's target, stays at least
 * 48px. Tapping a member opens their details, as on the built-in Home.
 *
 * The events counted are the next seven days, cut from Home's shared window
 * instead of asked for again.
 */
export function HomeFamilyMembersWidget({ box, editing }: HomeWidgetProps) {
  const { events, today } = useHomeDataContext();
  const week = useMemo(() => {
    const start = new Date(today);
    // Always an array: left undefined, FamilyMembers would ask for its own week.
    return eventsOverlapping(events, start, endOfDay(addDays(start, 7)));
  }, [events, today]);

  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const cap = useBoxFontSize(root, box);
  const stacked = cap !== null && box.height >= Math.max(48 + 2 * cap, STACKED_EM * cap) * 0.8;
  const fit = useFitToBox(content, box, [stacked, week, cap]);
  const size = fit !== null && cap !== null ? Math.min(fit, cap) : null;

  return (
    <div
      ref={root}
      data-testid="home-widget-familyMembers"
      data-stacked={stacked}
      inert={editing || undefined}
      className="flex size-full items-center justify-center overflow-hidden"
    >
      <div
        ref={content}
        className="block w-fit shrink-0"
        style={size !== null ? { fontSize: size } : { visibility: "hidden" }}
      >
        <FamilyMembers variant="box" stacked={stacked} events={week} />
      </div>
    </div>
  );
}
