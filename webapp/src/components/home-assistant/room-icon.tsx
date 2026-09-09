"use client";

import {
  Home,
  BedDouble,
  Sofa,
  Utensils,
  Bath,
  Car,
  TreeDeciduous,
  Briefcase,
  Baby,
  Tv,
  DoorOpen,
  Warehouse,
  Lamp,
  Armchair,
  WashingMachine,
  Coffee,
  Book,
} from "lucide-react";
import type { RoomIcon } from "@/types/home-assistant";

/**
 * The one table that turns a `rooms.icon` value into a component.
 *
 * It used to exist three times — byte-identical — in the lights FAB, the
 * rooms settings page and (once this page was rebuilt) the automation
 * screen. Three copies of a lookup table is three places to forget when
 * somebody adds an icon to the picker, and the branch this lives on exists
 * to remove exactly that kind of duplication.
 *
 * The picker's own lists (`ROOM_ICONS`, `ICON_LABEL_KEYS`) deliberately stay
 * in the rooms settings page: which icons a person may *choose*, and what
 * they are called, is the picker's business. Rendering one is everybody's.
 */
export const ICON_MAP: Record<RoomIcon, typeof Home> = {
  home: Home,
  "bed-double": BedDouble,
  sofa: Sofa,
  utensils: Utensils,
  bath: Bath,
  car: Car,
  tree: TreeDeciduous,
  briefcase: Briefcase,
  baby: Baby,
  tv: Tv,
  "door-open": DoorOpen,
  warehouse: Warehouse,
  lamp: Lamp,
  armchair: Armchair,
  "washing-machine": WashingMachine,
  coffee: Coffee,
  book: Book,
};

/**
 * A room's icon, tolerant of a null or unrecognised value from the row.
 *
 * `rooms.icon` is a nullable `text` column, not an enum, so a row written by
 * an older build — or by hand — can hold anything at all. Falling back to
 * `Home` keeps a room visible instead of crashing the group it heads.
 */
export function iconFor(icon: string | null): typeof Home {
  return (icon && ICON_MAP[icon as RoomIcon]) || Home;
}
