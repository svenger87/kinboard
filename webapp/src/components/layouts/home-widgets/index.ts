import type { ComponentType } from "react";
import type { HomeWidgetKey } from "@/lib/layouts/types";
import type { HomeWidgetProps } from "./shared";
import { CLOCKBLOCK_WIDGETS } from "./clock-block";
import { LISTS_WIDGETS } from "./lists";
import { REST_WIDGETS } from "./rest";
import { HOME_WIDGETS } from "@/lib/layouts/widgets";

export type { HomeWidgetProps } from "./shared";

/**
 * One component per Home widget in a designed layout, gathered from the three
 * groups RFC-022 §7.4 builds in turn. Each group owns its own file, so the
 * groups can be built side by side. A designed Home ships only once every key
 * of HOME_WIDGETS is here (`missingHomeWidgets()` is empty).
 */
export const HOME_WIDGET_COMPONENTS: Partial<Record<HomeWidgetKey, ComponentType<HomeWidgetProps>>> = {
  ...CLOCKBLOCK_WIDGETS,
  ...LISTS_WIDGETS,
  ...REST_WIDGETS,
};

/** The Home widgets that have no component in a box yet. */
export function missingHomeWidgets(): HomeWidgetKey[] {
  return (Object.keys(HOME_WIDGETS) as HomeWidgetKey[]).filter((k) => !HOME_WIDGET_COMPONENTS[k]);
}
