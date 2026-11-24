"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, endOfDay } from "date-fns";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { eventsOverlapping } from "@/lib/home-data";
import { useHomeDataContext } from "@/components/layouts/home-data-context";
import { FamilyMembers } from "@/components/widgets/family-members";
import { HOME_WIDGETS } from "@/lib/layouts/widgets";
import { useBoxFontSize } from "./frame";
import type { HomeWidgetProps } from "./shared";

/**
 * The family members in a box (RFC-022 §3.2): the avatars with their counts,
 * a fixed arrangement fitted to the box. With room for it (the widget's
 * comfort size, HOME_WIDGETS) the name and counts sit under each avatar, as
 * on the built-in Home, at its sizes (a 64px avatar, 14px names at text M);
 * in a flatter box, down to its minimum, they sit beside it. Drawn at the box's text size and only made smaller when the
 * box is too small; an avatar, and so a member's target, stays at least
 * 48px. Tapping a member opens their details, as on the built-in Home.
 *
 * The events counted are the next seven days, cut from Home's shared window
 * instead of asked for again.
 */
export function HomeFamilyMembersWidget({ box, editing }: HomeWidgetProps) {
  const { events, today, people } = useHomeDataContext();
  const week = useMemo(() => {
    const start = new Date(today);
    // Always an array: left undefined, FamilyMembers would ask for its own week.
    return eventsOverlapping(events, start, endOfDay(addDays(start, 7)));
  }, [events, today]);

  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const cap = useBoxFontSize(root, box);
  // Stacked, as on today's Home, when the box holds that (a pixel short still counts); else the names beside the avatars.
  const stacked = cap !== null && box.height >= HOME_WIDGETS.familyMembers.comfort!(cap).h - 1;
  // Names and counts are never drawn below their text size: in a box too
  // small for them beside the avatars, they are left out (`bare`) and the
  // avatars stand alone, each named by its title and label.
  const [bare, setBare] = useState(false);
  // Measured again once the members have loaded (their placeholder is a fixed 64px circle) and when anything else changes.
  const count = people?.length ?? 0;
  useLayoutEffect(() => setBare(false), [box.width, box.height, cap, stacked, week.length, count]);
  // And once the web fonts are in: measured in the fallback font, the names can come out wider.
  useLayoutEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => live && setBare(false)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const fit = useFitToBox(content, box, [stacked, week, cap, bare]);
  useLayoutEffect(() => {
    if (!bare && fit !== null && cap !== null && fit < cap * 0.95) setBare(true);
  }, [bare, fit, cap]);
  const size = fit !== null && cap !== null ? Math.min(fit, cap) : null;

  return (
    <div
      ref={root}
      data-testid="home-widget-familyMembers"
      data-stacked={stacked}
      data-bare={bare || undefined}
      data-fit={size === null || cap === null ? undefined : bare || size >= cap * 0.95 ? (bare ? "bare" : "full") : "shrunk"}
      inert={editing || undefined}
      className="flex size-full items-center justify-center overflow-hidden"
    >
      <div
        ref={content}
        className="block w-fit shrink-0"
        style={size !== null ? { fontSize: size } : { visibility: "hidden" }}
      >
        <FamilyMembers variant="box" stacked={stacked} labels={!bare} events={week} />
      </div>
    </div>
  );
}
