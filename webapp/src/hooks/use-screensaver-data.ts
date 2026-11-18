"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocale } from "next-intl";
import { getIntlLocale } from "@/i18n/intl-locale";
import { useClock } from "@/hooks/use-clock";
import { useBirthdays, useEvents, useHolidayEntries, usePeople, usePhotoSource, useNews, useEnergyConfig, useTeslaConfig, useHomeAssistantEntityStates, useToday, useWeather } from "@/hooks";
import { useScreensaverSettings } from "@/hooks/use-screensaver-settings";
import { screensaverListCount } from "@/types/screensaver";
import { nextEventLine } from "@/lib/next-event-line";
import { isScreensaverNight } from "@/lib/screensaver-night";
import { useCreatureBedtime, useFamilyTimeZone } from "@/hooks/use-creature-mood";
import { useFamilyStore } from "@/stores/family-store";
import { format, differenceInDays, setYear, addYears, isToday, isTomorrow, addDays, startOfDay, endOfDay, parseISO } from "date-fns";
import { type Locale } from "date-fns/locale";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { entryListDay, HOLIDAY_COLOR, holidayEndPattern, keyToDate } from "@/lib/holiday-entries";
import { toLocalDateKey } from "@/lib/local-date";
import { useTimeFormat } from "@/hooks/use-time-format";
import { aspectOf } from "@/lib/photo-fit";

/** Delay before cleaning up old blob URLs, allowing animations to finish (ms) */
const BLOB_CLEANUP_DELAY = 2500;

// No default photos — screensaver shows clock-only mode when Immich is not connected
const DEFAULT_PHOTOS: string[] = [];

// Parse date string safely without timezone shift
// "1990-01-28" should be January 28th local, not UTC midnight
export function parseBirthdayDate(dateStr: string): Date {
  return parseISO(dateStr + "T12:00:00");
}

// `now` defaults to the current date; pass a tick value (see `useToday`) so
// callers recompute when the calendar day rolls over.
export function getNextBirthday(date: Date, now: Date = new Date()): Date {
  const today = startOfDay(now);
  const thisYearBirthday = startOfDay(setYear(date, today.getFullYear()));

  if (differenceInDays(today, thisYearBirthday) > 0) {
    return addYears(thisYearBirthday, 1);
  }
  return thisYearBirthday;
}

export function getDaysUntilBirthday(date: Date, now: Date = new Date()): number {
  const nextBirthday = getNextBirthday(date, now);
  return differenceInDays(startOfDay(nextBirthday), startOfDay(now));
}

export function calculateUpcomingAge(birthDate: Date): number {
  const nextBirthday = getNextBirthday(birthDate);
  return nextBirthday.getFullYear() - birthDate.getFullYear();
}

/**
 * The order photos are shown in.
 *
 * Rotation used to pick a random index each time, excluding only the one on
 * screen — sampling with replacement. With the ~45 photos a fetch returns and
 * a 30-second rotation, that means a photo comes back around after roughly
 * ten others, about every five minutes, while a few of the fetched photos are
 * never shown at all before the hourly refetch replaces them. That is why the
 * same pictures kept turning up.
 *
 * A shuffle bag deals the whole set in a random order and only reshuffles
 * once it is exhausted, so every photo is shown before any repeats — first
 * repeat after 46 rather than 10, measured over the same pool.
 */
function makeShuffledOrder(length: number, avoidFirst = -1): number[] {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // Don't open a fresh bag with the photo that's already on screen — that's
  // the one visible repeat a shuffle can still produce, at the seam.
  if (length > 1 && order[0] === avoidFirst) {
    [order[0], order[order.length - 1]] = [order[order.length - 1], order[0]];
  }
  return order;
}

export function formatEventTime(
  start: Date,
  allDay: boolean | undefined,
  labels: { today: string; tomorrow: string },
  dateLocale: Locale,
  // Passed in rather than read here: this is a module-level helper, so it
  // can't call the hook that knows the household's 24-hour setting.
  formatTime: (value: Date | string | number) => string,
): string {
  if (allDay) {
    if (isToday(start)) return labels.today;
    if (isTomorrow(start)) return labels.tomorrow;
    return format(start, "EEE", { locale: dateLocale });
  }
  const timeStr = formatTime(start);
  if (isToday(start)) return `${labels.today}, ${timeStr}`;
  if (isTomorrow(start)) return `${labels.tomorrow}, ${timeStr}`;
  return `${format(start, "EEE", { locale: dateLocale })}, ${formatTime(start)}`;
}


/**
 * Everything the screensaver shows that is data rather than presentation: the
 * clock and date, the line before the next event, the weather, the upcoming
 * events (holidays among them), birthdays, news, the energy and Tesla values,
 * and which photo is on screen. The built-in screensaver and the widgets that
 * show the same content read it from here, so they cannot disagree.
 *
 * Every derived array and object is memoised: the result is passed on to
 * components whose effects depend on its identity.
 */
export function useScreensaverData({ photos }: { photos?: string[] } = {}) {
  const { use24Hour } = useTimeFormat();
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const intlLocale = getIntlLocale(locale);

  // Configurable photo rotation interval from settings
  const { photoRotationInterval, settings: screensaverSettings } = useScreensaverSettings();
  const eventCount = screensaverListCount(screensaverSettings.eventCount, 4);
  const birthdayCount = screensaverListCount(screensaverSettings.birthdayCount, 3);
  const showBirthdays = screensaverSettings.showBirthdays ?? true;
  const showNextEvent = screensaverSettings.showNextEvent ?? true;
  const photoRotationMs = photoRotationInterval * 1000;

  // Update clock every 60 seconds - screensaver only shows hours:minutes, not seconds
  // Without the second argument this defaulted to 24-hour, so the screensaver
  // ignored the household's setting entirely (issue #198).
  const { hours, minutes, date } = useClock(60000, use24Hour);
  // Night (RFC-021 §3.4): during the family's bedtime, a dim clock alone.
  const familyTimeZone = useFamilyTimeZone();
  const bedtime = useCreatureBedtime();
  const nightNow = isScreensaverNight(screensaverSettings.night, date, familyTimeZone, bedtime);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(-1); // -1 means not initialized
  // The shuffled running order and how far through it we are. Refs, because
  // advancing the bag must not re-render — the rotation effect already
  // re-runs on every photo change.
  const photoOrder = useRef<number[]>([]);
  const photoOrderCursor = useRef(0);
  const [previousPhotoIndex, setPreviousPhotoIndex] = useState(-1);

  // Fetch birthdays and events
  const { data: birthdays } = useBirthdays();
  const { data: people } = usePeople();

  // Fetch news
  const { data: news } = useNews();

  // Re-render at midnight so the query window and the birthday countdowns
  // follow the day. Nothing unmounts a screensaver, so without this it would
  // still be asking for the week it started in a week later.
  const today = useToday();

  // Get events for the next 7 days
  const { startDate, endDate } = useMemo(() => {
    const start = new Date(today); // useToday() is already start-of-day
    return {
      startDate: start.toISOString(),
      endDate: endOfDay(addDays(start, 7)).toISOString(),
    };
  }, [today]);
  const { data: events } = useEvents(startDate, endDate);
  // Public and school holidays in the same window, behind the calendar's
  // holiday switch; one a holiday calendar already lists is not listed twice.
  const todayKey = toLocalDateKey(new Date(today));
  const { entries: holidays } = useHolidayEntries(todayKey, toLocalDateKey(new Date(endDate)), events, { eventList: true });

  // Fetch photos from configured source (Immich or Unsplash)
  const { photos: sourcePhotos, isLoading: photosLoading } = usePhotoSource();
  const family = useFamilyStore((s) => s.family);

  // Weather chip (renders nothing when unconfigured)
  // `weather` is null when the server has no weather service (no API key);
  // a location it cannot resolve is an error, with no data.
  const { data: weather, isError: weatherFailed } = useWeather();

  // Fetch energy config and entity states for screensaver solar widget
  const energyConfig = useEnergyConfig();
  const energyEntityIds = useMemo(() => {
    if (!energyConfig?.show_on_screensaver) return [];
    return [
      energyConfig.solar_power,
      energyConfig.battery_soc,
      energyConfig.grid_power,
    ].filter((id): id is string => !!id);
  }, [energyConfig]);
  const { data: energyEntities } = useHomeAssistantEntityStates(
    energyEntityIds,
    !!energyConfig?.show_on_screensaver
  );

  // Parse energy values
  const solarPower = useMemo(() => {
    if (!energyConfig?.solar_power || !energyEntities) return null;
    const entity = energyEntities.find(e => e.entity_id === energyConfig.solar_power);
    return entity ? parseFloat(entity.state) : null;
  }, [energyConfig, energyEntities]);

  const batterySoc = useMemo(() => {
    if (!energyConfig?.battery_soc || !energyEntities) return null;
    const entity = energyEntities.find(e => e.entity_id === energyConfig.battery_soc);
    return entity ? parseFloat(entity.state) : null;
  }, [energyConfig, energyEntities]);

  const gridPower = useMemo(() => {
    if (!energyConfig?.grid_power || !energyEntities) return null;
    const entity = energyEntities.find(e => e.entity_id === energyConfig.grid_power);
    return entity ? parseFloat(entity.state) : null;
  }, [energyConfig, energyEntities]);

  // Fetch Tesla config and entity states for screensaver Tesla widget
  const teslaConfig = useTeslaConfig();
  const teslaEntityIds = useMemo(() => {
    if (!teslaConfig?.show_on_screensaver) return [];
    return [
      teslaConfig.battery_level,
      teslaConfig.battery_range,
      teslaConfig.charging_rate || teslaConfig.charger_power,
    ].filter((id): id is string => !!id);
  }, [teslaConfig]);
  const { data: teslaEntities } = useHomeAssistantEntityStates(
    teslaEntityIds,
    !!teslaConfig?.show_on_screensaver
  );

  // Parse Tesla values
  const teslaBattery = useMemo(() => {
    if (!teslaConfig?.battery_level || !teslaEntities) return null;
    const entity = teslaEntities.find(e => e.entity_id === teslaConfig.battery_level);
    return entity ? parseFloat(entity.state) : null;
  }, [teslaConfig, teslaEntities]);

  const teslaRange = useMemo(() => {
    if (!teslaConfig?.battery_range || !teslaEntities) return null;
    const entity = teslaEntities.find(e => e.entity_id === teslaConfig.battery_range);
    return entity ? parseFloat(entity.state) : null;
  }, [teslaConfig, teslaEntities]);

  const teslaChargingRate = useMemo(() => {
    const sensorId = teslaConfig?.charging_rate || teslaConfig?.charger_power;
    if (!sensorId || !teslaEntities) return null;
    const entity = teslaEntities.find(e => e.entity_id === sensorId);
    return entity ? parseFloat(entity.state) : null;
  }, [teslaConfig, teslaEntities]);

  const showEnergyWidget = energyConfig?.show_on_screensaver && solarPower !== null;
  const showTeslaWidget = teslaConfig?.show_on_screensaver && teslaBattery !== null;

  // Use source photos if available, otherwise use props or default
  const photoUrls = useMemo(() => {
    if (sourcePhotos && sourcePhotos.length > 0) {
      return sourcePhotos.map((p) => p.url);
    }
    return photos || DEFAULT_PHOTOS;
  }, [sourcePhotos, photos]);

  // Photos already reported to Unsplash this session. Their guidelines want
  // one request per display event, not one per render.
  const reportedDownloads = useRef<Set<string>>(new Set());

  // Get metadata for the current photo (for Unsplash attribution)
  const currentPhotoMetadata = useMemo(() => {
    if (currentPhotoIndex < 0 || !sourcePhotos || sourcePhotos.length === 0) return null;
    return sourcePhotos[currentPhotoIndex]?.metadata || null;
  }, [currentPhotoIndex, sourcePhotos]);

  // Dimensions where the source reports them (the uploaded library does; the
  // other four do not). null means "let the browser measure it on load".
  const aspectAt = useCallback(
    (index: number): number | null => {
      if (index < 0 || !sourcePhotos) return null;
      const photo = sourcePhotos[index];
      return photo ? aspectOf(photo.width, photo.height) : null;
    },
    [sourcePhotos],
  );

  // Tell Unsplash the photo was displayed.
  //
  // Their guidelines: "When your application performs something similar to a
  // download (like when a user chooses the image to include in a blog post,
  // set as a header, etc.), you must send a request to the download endpoint."
  // Showing one as wallpaper is that event, and Kinboard has never sent it —
  // which is how a photographer's download count reflects the use.
  //
  // Fire and forget, once per photo per session: it reports something that
  // already happened, so a failure must not affect what happens next.
  useEffect(() => {
    const downloadLocation = currentPhotoMetadata?.downloadLocation;
    const familyId = family?.id;
    if (!downloadLocation || !familyId) return;
    if (reportedDownloads.current.has(downloadLocation)) return;
    reportedDownloads.current.add(downloadLocation);

    void fetch("/api/unsplash/track-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ family_id: familyId, download_location: downloadLocation }),
      keepalive: true,
    }).catch(() => {
      // Reporting is best-effort; the screensaver carries on regardless.
    });
  }, [currentPhotoMetadata, family?.id]);

  // Blob URL cache
  const blobCache = useRef<Map<number, string>>(new Map());
  const [currentBlobUrl, setCurrentBlobUrl] = useState<string | null>(null);
  const [previousBlobUrl, setPreviousBlobUrl] = useState<string | null>(null);

  // Load image as blob and create object URL
  const loadImageAsBlob = useCallback(async (url: string): Promise<string | null> => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }, []);

  // Cleanup old blob URLs to free memory
  const cleanupOldBlobs = useCallback((keepIndices: number[]) => {
    const toDelete: number[] = [];
    blobCache.current.forEach((blobUrl, index) => {
      if (!keepIndices.includes(index)) {
        URL.revokeObjectURL(blobUrl);
        toDelete.push(index);
      }
    });
    toDelete.forEach(index => blobCache.current.delete(index));
  }, []);

  // Initialize: load first random photo
  useEffect(() => {
    if (photoUrls.length === 0 || currentPhotoIndex !== -1) return;

    photoOrder.current = makeShuffledOrder(photoUrls.length);
    photoOrderCursor.current = 1;
    const initIndex = photoOrder.current[0];

    (async () => {
      const blobUrl = await loadImageAsBlob(photoUrls[initIndex]);
      if (blobUrl) {
        blobCache.current.set(initIndex, blobUrl);
        // Set index and blob URL together — no gap, no flicker
        setCurrentBlobUrl(blobUrl);
        setCurrentPhotoIndex(initIndex);
      }
    })();
  }, [photoUrls, currentPhotoIndex, loadImageAsBlob]);

  // Rotate photos at configured interval — preload fully before switching
  useEffect(() => {
    // No photos at night: nothing to show them, nothing to download.
    if (nightNow || photoUrls.length <= 1 || currentPhotoIndex === -1) return;

    const timer = setInterval(async () => {
      // A new set of photos arrived (the hourly refetch), or the bag ran
      // out — deal a fresh one rather than indexing into a stale order.
      if (
        photoOrder.current.length !== photoUrls.length ||
        photoOrderCursor.current >= photoOrder.current.length
      ) {
        photoOrder.current = makeShuffledOrder(photoUrls.length, currentPhotoIndex);
        photoOrderCursor.current = 0;
      }
      const nextIndex = photoOrder.current[photoOrderCursor.current];
      photoOrderCursor.current += 1;

      // Ensure the next image blob is ready before switching
      let nextBlobUrl = blobCache.current.get(nextIndex) ?? null;
      if (!nextBlobUrl) {
        nextBlobUrl = await loadImageAsBlob(photoUrls[nextIndex]);
        if (nextBlobUrl) {
          blobCache.current.set(nextIndex, nextBlobUrl);
        }
      }

      if (!nextBlobUrl) return; // skip transition if load failed

      // Set all state atomically — React batches these, so only one render
      setPreviousBlobUrl(currentBlobUrl);
      setPreviousPhotoIndex(currentPhotoIndex);
      setCurrentBlobUrl(nextBlobUrl);
      setCurrentPhotoIndex(nextIndex);

      // Cleanup old blobs after crossfade animation completes
      setTimeout(() => {
        cleanupOldBlobs([nextIndex, currentPhotoIndex].filter(i => i >= 0));
      }, BLOB_CLEANUP_DELAY);
    }, photoRotationMs);

    return () => clearInterval(timer);
  }, [photoUrls, currentPhotoIndex, currentBlobUrl, photoRotationMs, loadImageAsBlob, cleanupOldBlobs, nightNow]);

  // Proactively preload the next image mid-interval so it's ready when the timer fires
  useEffect(() => {
    if (photoUrls.length <= 1 || currentPhotoIndex === -1) return;

    const preloadTimer = setTimeout(async () => {
      // Preload the photo that is genuinely next, not a guess. This used to
      // pick at random, which with a set of ~45 had about a one-in-45 chance
      // of preloading the one actually shown next — so the crossfade nearly
      // always waited on a cold fetch anyway. The running order knows.
      const order = photoOrder.current;
      if (order.length === 0) return;
      const candidateIndex = order[photoOrderCursor.current % order.length];
      if (!blobCache.current.has(candidateIndex)) {
        const blobUrl = await loadImageAsBlob(photoUrls[candidateIndex]);
        if (blobUrl) {
          blobCache.current.set(candidateIndex, blobUrl);
        }
      }
    }, photoRotationMs / 2);

    return () => clearTimeout(preloadTimer);
  }, [photoUrls, currentPhotoIndex, photoRotationMs, loadImageAsBlob]);

  // Cleanup all blobs on unmount
  useEffect(() => {
    const cache = blobCache.current;
    return () => {
      cache.forEach(blobUrl => URL.revokeObjectURL(blobUrl));
      cache.clear();
    };
  }, []);

  const formattedDate = date.toLocaleDateString(intlLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Birthdays in the next 30 days, all of them: a layout's birthday list
  // shows as many as fit its box. The built-in shows the first few, below.
  const birthdaysAhead = useMemo(() => {
    if (!birthdays) return [];
    return birthdays
      .map((birthday) => {
        const person = people?.find((p) => p.id === birthday.person_id);
        return {
          id: birthday.id,
          name: birthday.name,
          date: parseBirthdayDate(birthday.date),
          daysUntil: getDaysUntilBirthday(parseBirthdayDate(birthday.date), new Date(today)),
          personColor: person?.color,
        };
      })
      .filter((b) => b.daysUntil <= 30)
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }, [birthdays, people, today]);

  // Process upcoming birthdays (next 30 days)
  const upcomingBirthdays = useMemo(
    () => (showBirthdays ? birthdaysAhead.slice(0, birthdayCount) : []),
    [birthdaysAhead, showBirthdays, birthdayCount],
  );

  // Process upcoming events. Holidays are all-day items among them, counted
  // against the same rows (four unless the family chose 1 to 5); a break already under way is filed under
  // today, with the day it ends.
  const eventsAhead = useMemo(() => {
    const holidayItems = holidays.map((h) => ({
      id: h.id,
      title: h.emoji ? `${h.emoji} ${h.title}` : h.title,
      start: entryListDay(h, todayKey),
      allDay: true,
      location: null as string | null,
      color: HOLIDAY_COLOR,
      personName: null as string | null,
      personColor: null as string | null,
      personAvatar: null as string | null,
      holiday: h.kind,
      until: h.endKey > h.startKey ? format(keyToDate(h.endKey), holidayEndPattern(locale), { locale: dateLocale }) : null,
    }));
    const eventItems = (events ?? [])
      .map((event) => {
        const personId = event.person_id || event.calendar?.person_id;
        const person = personId ? people?.find((p) => p.id === personId) : undefined;
        return {
          id: event.id,
          title: event.title,
          start: new Date(event.start_at),
          allDay: event.all_day,
          location: event.location,
          color: person?.color || event.calendar?.color || "#3b82f6",
          personName: person?.name ?? null,
          personColor: person?.color ?? null,
          personAvatar: person?.avatar_url ?? null,
          holiday: null,
          until: null,
        };
      });
    // Holidays first, so on a tie the sort (stable) keeps them ahead.
    return [...holidayItems, ...eventItems]
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [events, people, holidays, todayKey, locale, dateLocale]);
  // The built-in lists the first few; a layout's list as many as fit its box.
  const upcomingEvents = useMemo(() => eventsAhead.slice(0, eventCount), [eventsAhead, eventCount]);

  // In the hour before an event that starts at a time, one line under the
  // date (RFC-021 §3.2). `date` is the clock's, so it moves on the minute.
  const soon = useMemo(() => {
    if (!showNextEvent) return null;
    return nextEventLine(
      (events ?? []).map((e) => ({
        title: e.title,
        start: new Date(e.start_at),
        allDay: e.all_day,
        personId: e.person_id || e.calendar?.person_id || null,
      })),
      date,
      people ?? [],
    );
  }, [showNextEvent, events, date, people]);

  return {
    hours,
    minutes,
    date,
    nightNow,
    formattedDate,
    soon,
    weather,
    weatherFailed,
    upcomingEvents,
    upcomingBirthdays,
    eventsAhead,
    birthdaysAhead,
    news,
    showEnergyWidget,
    showTeslaWidget,
    solarPower,
    batterySoc,
    gridPower,
    teslaBattery,
    teslaRange,
    teslaChargingRate,
    photoUrls,
    photoCount: photoUrls.length,
    photosLoading,
    photoIndex: currentPhotoIndex,
    previousPhotoIndex,
    currentBlobUrl,
    previousBlobUrl,
    aspectAt,
    currentPhotoMetadata,
  };
}
