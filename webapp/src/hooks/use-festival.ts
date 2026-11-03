"use client";

import { useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { useSetting } from "@/hooks/use-supabase-queries";
import { useHolidayRegion } from "@/hooks/use-holiday-region";
import { useFamilyTimeZone, useMinuteClock } from "@/hooks/use-creature-mood";
import { useMotion } from "@/hooks/use-motion";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { MINUTE_MS } from "@/lib/minute-clock";
import { parseClockTime, type FestivalId } from "@/lib/festivals";
import { type FestivalStage,
  DEFAULT_FESTIVAL_SETTINGS,
  FESTIVAL_KITS,
  FESTIVAL_PREVIEW_MS,
  FESTIVAL_STORAGE_KEY,
  currentFestival,
  festivalStage,
  normalizeFestivalSettings,
  parseFestivalPreview,
  withFestivalOutfit,
  type FestivalKit,
  type FestiveLookFields,
} from "@/lib/festival-settings";
import { releaseVisitorSprites } from "@/components/festival-visitors";

/**
 * The festival on this screen (RFC-020): the family's, from its setting, its
 * holiday region and its clock, or a preview. One provider works it out
 * (useFestivalSync, in ThemeSettingsProvider) and puts it on
 * `<html data-festival data-festival-stage>`, which the colour wash and the
 * dressing in globals.css key off; the scene and the creatures read it with
 * useFestival().
 */

export interface ShownFestival {
  id: FestivalId;
  stage: FestivalStage | null;
  kit: FestivalKit;
  /** A preview (§4): shown whatever the date. */
  preview: boolean;
}

interface FestivalState {
  /** The family's festival now, from the clock; undefined until the setting has loaded. */
  active: { id: FestivalId; stage: FestivalStage | null } | null | undefined;
  /** A preview, until a time. */
  preview: { id: FestivalId; until: number } | null;
}

const useFestivalStore = create<FestivalState>(() => ({ active: undefined, preview: null }));

/** Kept for the length of a preview, as the weather's: taking the parameter out of the address redraws the page. */
const PREVIEW_STORE = "kinboard.festivalPreview";

/** Show `id` on this screen for FESTIVAL_PREVIEW_MS, whatever the date (Settings' Preview, `?festival-preview=`). */
export function startFestivalPreview(id: FestivalId, until = Date.now() + FESTIVAL_PREVIEW_MS) {
  useFestivalStore.setState({ preview: { id, until } });
  try {
    window.sessionStorage.setItem(PREVIEW_STORE, JSON.stringify({ id, until }));
  } catch {
    // No storage (a private window): the preview lasts as long as this page.
  }
}

export function stopFestivalPreview() {
  useFestivalStore.setState({ preview: null });
  try {
    window.sessionStorage.removeItem(PREVIEW_STORE);
  } catch {
    // nothing kept
  }
}

/** What this screen shows: a preview first, else the family's festival; null when none. */
export function useFestival(): ShownFestival | null {
  const active = useFestivalStore((s) => s.active);
  const preview = useFestivalStore((s) => s.preview);
  return useMemo(() => {
    if (preview) {
      const kit = FESTIVAL_KITS[preview.id];
      // A preview of St Nicholas shows the morning's filled boot.
      return kit ? { id: preview.id, stage: preview.id === "st-nicholas" ? "day" : null, kit, preview: true } : null;
    }
    const kit = active ? FESTIVAL_KITS[active.id] : undefined;
    if (!active || !kit) return null;
    // St Martin before dusk: the wash and the dressing, but the walk waits.
    if (active.id === "st-martin" && active.stage !== "dusk") return { ...active, kit: { ...kit, visitor: null }, preview: false };
    return { ...active, kit, preview: false };
  }, [active, preview]);
}

/**
 * A creature's look as the screens draw it during a festival: the festival's
 * item instead of the child's own (§2.3), unless the child switched it off.
 * Not with Animations off, which leaves the colour wash only (§4).
 */
export function useFestivalLook(): <L extends FestiveLookFields>(look: L) => L {
  const festival = useFestival();
  const motion = useMotion();
  const id = motion === "off" ? null : (festival?.id ?? null);
  return useMemo(() => <L extends FestiveLookFields>(look: L) => withFestivalOutfit(look, id), [id]);
}

/** The weather's sunset today, if a screen has it already: St Martin's dusk. Never a fetch of its own. */
function cachedSunset(queryClient: ReturnType<typeof useQueryClient>): number | null {
  for (const [, data] of queryClient.getQueriesData<{ sunset?: string } | null>({ queryKey: ["weather"] })) {
    const minutes = parseClockTime(data?.sunset);
    if (minutes !== null) return minutes;
  }
  return null;
}

/**
 * Works out the festival once a minute and keeps `<html>` in step. The
 * setting is re-read every minute like the weather effects' (#429), so a
 * change on another screen reaches this one by itself.
 */
export function useFestivalSync() {
  const { data: stored, isSuccess } = useSetting<unknown>(SETTINGS_KEYS.festivals, DEFAULT_FESTIVAL_SETTINGS, { refetchInterval: 60_000 });
  const settings = useMemo(() => normalizeFestivalSettings(stored), [stored]);
  const { region, isLoading: regionLoading } = useHolidayRegion();
  const timeZone = useFamilyTimeZone();
  const minute = useMinuteClock();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const active = useFestivalStore((s) => s.active);
  const preview = useFestivalStore((s) => s.preview);

  // The family's festival, this minute.
  useEffect(() => {
    if (minute === 0 || !isSuccess || regionLoading) return;
    const now = new Date(minute * MINUTE_MS);
    const on = currentFestival(now, settings, region, timeZone, { duskMinutes: cachedSunset(queryClient) });
    const next = on ? { id: on.id, stage: festivalStage(on) } : null;
    const prev = useFestivalStore.getState().active;
    // Undefined (not worked out yet) becomes null too: that is what lets the attribute go.
    if (prev === undefined || prev?.id !== next?.id || prev?.stage !== next?.stage) useFestivalStore.setState({ active: next });
    // Remembered for the next page load, so the wash and the dressing are
    // there from the first paint (FESTIVAL_INIT_SCRIPT), not a second later.
    try {
      if (on) window.localStorage.setItem(FESTIVAL_STORAGE_KEY, JSON.stringify({ id: on.id, stage: next?.stage ?? null, start: on.start, end: on.end }));
      else window.localStorage.removeItem(FESTIVAL_STORAGE_KEY);
    } catch {
      // No storage: the attribute arrives with the first minute instead.
    }
  }, [minute, settings, isSuccess, region, regionLoading, timeZone, queryClient]);

  // `?festival-preview=christmas` on Home (§4); it outlives taking the parameter out of the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const asked = pathname === "/" ? parseFestivalPreview(url.searchParams.get("festival-preview")) : null;
    if (asked) {
      startFestivalPreview(asked);
      url.searchParams.delete("festival-preview");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      return;
    }
    if (useFestivalStore.getState().preview) return;
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(PREVIEW_STORE) ?? "null");
      const id = parseFestivalPreview(saved?.id);
      if (id && typeof saved.until === "number" && saved.until > Date.now()) useFestivalStore.setState({ preview: { id, until: saved.until } });
    } catch {
      // nothing kept
    }
  }, [pathname]);

  // A preview ends by itself.
  useEffect(() => {
    if (!preview) return;
    const timer = window.setTimeout(stopFestivalPreview, Math.max(0, preview.until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [preview]);

  // `<html data-festival>`: the wash and the dressing (globals.css).
  const shown = preview ? { id: preview.id, stage: preview.id === "st-nicholas" ? "day" : null } : active;
  useEffect(() => {
    const html = document.documentElement;
    // Not worked out yet: whatever FESTIVAL_INIT_SCRIPT put there stays.
    if (shown === undefined) return;
    if (shown) {
      html.setAttribute("data-festival", shown.id);
      if (shown.stage) html.setAttribute("data-festival-stage", shown.stage);
      else html.removeAttribute("data-festival-stage");
    } else {
      html.removeAttribute("data-festival");
      html.removeAttribute("data-festival-stage");
    }
  }, [shown?.id, shown?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // The visitor's bitmaps are released when its festival ends (RFC-020 §7).
  const visitor = shown ? FESTIVAL_KITS[shown.id]?.visitor : null;
  useEffect(() => {
    releaseVisitorSprites((kind) => kind === visitor);
  }, [visitor]);
}
