"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import { getIntlLocale } from "@/i18n/intl-locale";
import { useClock } from "@/hooks/use-clock";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useBirthdays, useEvents, usePeople, usePhotoSource, useNews, useEnergyConfig, useTeslaConfig, useHomeAssistantEntityStates, useToday, useWeather, type NewsItem } from "@/hooks";
import { useScreensaverSettings } from "@/hooks/use-screensaver-settings";
import { useFamilyStore } from "@/stores/family-store";
import { NewsArticleSheet } from "@/components/news-article-sheet";
import { PersonAvatar } from "@/components/person-avatar";
import { Cake, Calendar, MapPin, Newspaper, X, ExternalLink, BookOpen, Clock, Sun, Cloud, CloudRain, CloudSnow, CloudLightning, Battery, Zap, Car } from "lucide-react";
import { format, differenceInDays, setYear, isPast, addYears, isToday, isTomorrow, addDays, startOfDay, endOfDay, parseISO } from "date-fns";
import { type Locale } from "date-fns/locale";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { hasBirthYear } from "@/lib/birthday";
import { useTimeFormat } from "@/hooks/use-time-format";

// Parse date string safely without timezone shift
// "1990-01-28" should be January 28th local, not UTC midnight
function parseBirthdayDate(dateStr: string): Date {
  return parseISO(dateStr + "T12:00:00");
}
/** Delay before cleaning up old blob URLs, allowing animations to finish (ms) */
const BLOB_CLEANUP_DELAY = 2500;
/** Auto-close news modal after this much inactivity (ms) */
const MODAL_INACTIVITY_TIMEOUT = 5 * 60 * 1000;

/**
 * Burn-in mitigation for the overlays.
 *
 * The photo behind them changes every half minute, but the clock, the news
 * list and the events column sit on the exact same pixels for as long as the
 * screensaver is up — days, on a wall display. Bright glyphs held that still
 * age an OLED (and mark some LCDs) unevenly.
 *
 * So the overlay layer walks a small closed loop of offsets: nothing moves far
 * enough or fast enough to catch the eye, but no edge stays on one pixel.
 */
const BURN_IN_OFFSETS = ["0px 0px", "8px 5px", "-5px 8px", "6px -7px", "-8px -4px"];
const BURN_IN_INTERVAL = 4 * 60 * 1000;
/** Long enough that the shift reads as drift rather than a step. */
const BURN_IN_TRANSITION = "translate 6s ease-in-out";

interface ScreensaverProps {
  photos?: string[];
}

// `now` defaults to the current date; pass a tick value (see `useToday`) so
// callers recompute when the calendar day rolls over.
function getNextBirthday(date: Date, now: Date = new Date()): Date {
  const today = startOfDay(now);
  const thisYearBirthday = startOfDay(setYear(date, today.getFullYear()));

  if (differenceInDays(today, thisYearBirthday) > 0) {
    return addYears(thisYearBirthday, 1);
  }
  return thisYearBirthday;
}

function getDaysUntilBirthday(date: Date, now: Date = new Date()): number {
  const nextBirthday = getNextBirthday(date, now);
  return differenceInDays(startOfDay(nextBirthday), startOfDay(now));
}

function calculateUpcomingAge(birthDate: Date): number {
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

function formatEventTime(
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

// No default photos — screensaver shows clock-only mode when Immich is not connected
const DEFAULT_PHOTOS: string[] = [];

function screensaverWeatherIcon(condition: string) {
  const c = condition.toLowerCase();
  if (c.includes("thunder") || c.includes("gewitter")) return CloudLightning;
  if (c.includes("snow") || c.includes("schnee")) return CloudSnow;
  if (c.includes("rain") || c.includes("regen") || c.includes("drizzle") || c.includes("niesel")) return CloudRain;
  if (c.includes("clear") || c.includes("klar") || c.includes("sun") || c.includes("sonn")) return Sun;
  return Cloud;
}

export function Screensaver({ photos }: ScreensaverProps) {
  const { formatTime } = useTimeFormat();
  const t = useTranslations("components.screensaver");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const intlLocale = getIntlLocale(locale);
  const eventLabels = useMemo(
    () => ({ today: t("eventToday"), tomorrow: t("eventTomorrow") }),
    [t]
  );

  // Configurable photo rotation interval from settings
  const { photoRotationInterval } = useScreensaverSettings();
  const photoRotationMs = photoRotationInterval * 1000;

  // Update clock every 60 seconds - screensaver only shows hours:minutes, not seconds
  const { hours, minutes, date } = useClock(60000);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(-1); // -1 means not initialized
  // The shuffled running order and how far through it we are. Refs, because
  // advancing the bag must not re-render — the rotation effect already
  // re-runs on every photo change.
  const photoOrder = useRef<number[]>([]);
  const photoOrderCursor = useRef(0);
  const [previousPhotoIndex, setPreviousPhotoIndex] = useState(-1);
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const [modalLastInteraction, setModalLastInteraction] = useState<number>(0);

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

  // Fetch photos from configured source (Immich or Unsplash)
  const { photos: sourcePhotos } = usePhotoSource();
  const family = useFamilyStore((s) => s.family);

  // Weather chip (renders nothing when unconfigured)
  const { data: weather } = useWeather();
  const WeatherIcon = weather ? screensaverWeatherIcon(weather.conditionMain ?? weather.condition) : null;


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
    if (photoUrls.length <= 1 || currentPhotoIndex === -1) return;

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
  }, [photoUrls, currentPhotoIndex, currentBlobUrl, photoRotationMs, loadImageAsBlob, cleanupOldBlobs]);

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

  // Set body attribute when modal is open to disable screensaver wake
  useEffect(() => {
    if (selectedNews) {
      document.body.setAttribute("data-modal-open", "true");
      setModalLastInteraction(Date.now());
    } else {
      document.body.removeAttribute("data-modal-open");
    }

    return () => {
      document.body.removeAttribute("data-modal-open");
    };
  }, [selectedNews]);

  // Auto-close modal after 5 minutes of no interaction
  useEffect(() => {
    if (!selectedNews || !modalLastInteraction) return;

    const timeElapsed = Date.now() - modalLastInteraction;
    const timeRemaining = MODAL_INACTIVITY_TIMEOUT - timeElapsed;

    if (timeRemaining <= 0) {
      setSelectedNews(null);
      return;
    }

    const timer = setTimeout(() => {
      setSelectedNews(null);
    }, timeRemaining);

    return () => clearTimeout(timer);
  }, [selectedNews, modalLastInteraction]);

  // Step the overlay layer around its offset loop (see BURN_IN_OFFSETS)
  const [burnInStep, setBurnInStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setBurnInStep((step) => (step + 1) % BURN_IN_OFFSETS.length);
    }, BURN_IN_INTERVAL);
    return () => clearInterval(timer);
  }, []);
  // The CSS `translate` property, not a transform: it composes with the
  // entry animations and the `-translate-x-1/2` centering already on these
  // elements instead of overwriting them.
  const burnInStyle = useMemo(
    () => ({ translate: BURN_IN_OFFSETS[burnInStep], transition: BURN_IN_TRANSITION }),
    [burnInStep]
  );

  // Track modal interaction
  const handleModalInteraction = () => {
    setModalLastInteraction(Date.now());
  };

  // Format relative time for news
  const formatNewsTime = (pubDate: string) => {
    try {
      const date = new Date(pubDate);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);

      if (diffMins < 1) return t("newsJustNow");
      if (diffMins < 60) return t("newsMinutes", { minutes: diffMins });
      if (diffHours < 24) return t("newsHours", { hours: diffHours });
      return format(date, locale === "de" ? "dd.MM." : "MMM d", { locale: dateLocale });
    } catch {
      return "";
    }
  };

  const formattedDate = date.toLocaleDateString(intlLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Process upcoming birthdays (next 30 days)
  const upcomingBirthdays = useMemo(() => {
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
      .sort((a, b) => a.daysUntil - b.daysUntil)
      .slice(0, 3);
  }, [birthdays, people, today]);

  // Process upcoming events
  const upcomingEvents = useMemo(() => {
    if (!events) return [];
    return events
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
        };
      })
      .slice(0, 4);
  }, [events, people]);

  return (
    <div className="fixed inset-0 bg-black z-[100] screensaver-fade-in">
      {/* Background Photo - Only render current and previous for performance */}
      <div className="absolute inset-0">
        {/* Previous photo (fading out) */}
        {previousBlobUrl && previousPhotoIndex !== currentPhotoIndex && (
          <img
            key={`prev-${previousPhotoIndex}`}
            src={previousBlobUrl}
            alt=""
            decoding="async"
            className="absolute inset-0 size-full object-cover screensaver-photo screensaver-photo-out"
          />
        )}
        {/* Current photo (fading in) */}
        {currentBlobUrl && (
          <img
            key={`curr-${currentPhotoIndex}`}
            src={currentBlobUrl}
            alt=""
            decoding="async"
            className="absolute inset-0 size-full object-cover screensaver-photo screensaver-photo-in"
          />
        )}

        {/* Gradient overlay for readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40" />
      </div>

      {/* News list - top left (always rendered for data-no-wake) */}
      {news && news.length > 0 && (
        <div
          className={`absolute top-0 left-0 landscape:lg:top-0 landscape:lg:left-0 p-4 pt-16 landscape:lg:p-12 w-96 landscape:lg:w-[28rem] safe-area-inset screensaver-slide-down ${selectedNews ? 'opacity-0 pointer-events-none' : ''}`}
          style={{ animationDelay: "0.8s", backgroundColor: "rgba(0,0,0,0.001)", ...burnInStyle }}
          data-no-wake
        >
          <div className="flex items-center gap-2 text-white/60 mb-3">
            <Newspaper className="size-4" />
            <span className="text-xs landscape:lg:text-sm font-medium uppercase tracking-wider">{t("newsLabel")}</span>
          </div>
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto scrollbar-hide">
            {news.slice(0, 6).map((item) => (
              <button
                key={item.link}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedNews(item);
                }}
                className="w-full flex gap-3 bg-black/50 rounded-lg p-2 hover:bg-black/60 transition-colors text-left group gpu-blur"
              >
                {item.image && (
                  <div className="size-16 rounded-md overflow-hidden shrink-0 bg-white/10">
                    <img
                      src={item.image}
                      alt=""
                      className="size-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium leading-snug line-clamp-2 group-hover:text-white/90">
                    {item.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {item.category && (
                      <span className="text-xs text-info/80 font-medium">
                        {item.category}
                      </span>
                    )}
                    <span className="text-xs text-white/40">
                      {formatNewsTime(item.pubDate)}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Weather chip - top right (renders nothing when weather unconfigured) */}
      {weather && WeatherIcon && (
        <div
          className="absolute top-4 right-4 landscape:lg:top-12 landscape:lg:right-12 safe-area-inset screensaver-slide-down"
          style={{ animationDelay: "0.85s", ...burnInStyle }}
        >
          <div className="flex items-center gap-3 bg-black/40 rounded-xl px-4 py-2.5">
            <WeatherIcon className="size-7 text-white" strokeWidth={1.75} />
            <span className="font-display font-light text-3xl text-white tabular-nums leading-none">
              {Math.round(weather.temp)}°
            </span>
          </div>
        </div>
      )}

      {/* Energy + Tesla widget - top right (if either enabled) */}
      {(showEnergyWidget || showTeslaWidget) && (
        <div
          className="absolute top-20 right-4 landscape:lg:top-28 landscape:lg:right-12 pt-12 landscape:lg:pt-0 safe-area-inset screensaver-slide-down"
          style={{ animationDelay: "0.9s", ...burnInStyle }}
        >
          <div className="bg-black/50 rounded-xl p-4 flex flex-col gap-3 gpu-blur">
            {/* Solar Power */}
            {showEnergyWidget && solarPower !== null && (
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-energy-solar/20">
                  <Sun className="size-5 text-energy-solar" />
                </div>
                <div>
                  <p className="text-white/60 text-xs">Solar</p>
                  <p className="text-white font-medium">
                    {solarPower >= 1000
                      ? `${(solarPower / 1000).toFixed(1)} kW`
                      : `${Math.round(solarPower)} W`}
                  </p>
                </div>
              </div>
            )}

            {/* Battery SOC */}
            {showEnergyWidget && batterySoc !== null && (
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-energy-battery/20">
                  <Battery className="size-5 text-energy-battery" />
                </div>
                <div>
                  <p className="text-white/60 text-xs">Batterie</p>
                  <p className="text-white font-medium">{Math.round(batterySoc)}%</p>
                </div>
              </div>
            )}

            {/* Grid Power */}
            {showEnergyWidget && gridPower !== null && (
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${gridPower > 0 ? 'bg-destructive/20' : 'bg-success/20'}`}>
                  <Zap className={`size-5 ${gridPower > 0 ? 'text-destructive' : 'text-success'}`} />
                </div>
                <div>
                  <p className="text-white/60 text-xs">{gridPower > 0 ? 'Bezug' : 'Einspeisung'}</p>
                  <p className="text-white font-medium">
                    {Math.abs(gridPower) >= 1000
                      ? `${(Math.abs(gridPower) / 1000).toFixed(1)} kW`
                      : `${Math.round(Math.abs(gridPower))} W`}
                  </p>
                </div>
              </div>
            )}

            {/* Divider between energy and Tesla */}
            {showEnergyWidget && showTeslaWidget && (
              <div className="border-t border-white/10" />
            )}

            {/* Tesla Battery */}
            {showTeslaWidget && teslaBattery !== null && (
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/20">
                  <Car className="size-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-white/60 text-xs">Tesla</p>
                  <p className="text-white font-medium">
                    {Math.round(teslaBattery)}%
                    {teslaRange !== null && <span className="text-white/50 text-xs ml-1.5">· {Math.round(teslaRange)} km</span>}
                  </p>
                </div>
              </div>
            )}

            {/* Tesla Charging */}
            {showTeslaWidget && teslaChargingRate !== null && teslaChargingRate > 0 && (
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-energy-grid/20">
                  <Zap className="size-5 text-energy-grid" />
                </div>
                <div>
                  <p className="text-white/60 text-xs">Laden</p>
                  <p className="text-white font-medium">{teslaChargingRate.toFixed(1)} kW</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* News detail modal */}
      <AnimatePresence>
        {selectedNews && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/85"
            role="dialog"
            aria-modal="true"
            aria-label={selectedNews.title}
            data-no-wake
            onClick={() => setSelectedNews(null)}
            onMouseMove={handleModalInteraction}
            onTouchStart={handleModalInteraction}
            onKeyDown={(e) => { if (e.key === "Escape") setSelectedNews(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: "spring", damping: 25 }}
              className="bg-zinc-900 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* News image */}
              {selectedNews.image && (
                <div className="relative w-full h-48 landscape:lg:h-64 bg-zinc-800">
                  <img
                    src={selectedNews.image}
                    alt=""
                    className="size-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/80 to-transparent" />
                </div>
              )}

              {/* Close button */}
              <button
                onClick={() => setSelectedNews(null)}
                className="absolute top-4 right-4 p-2.5 rounded-lg bg-black/50 hover:bg-white/10 text-white/80 hover:text-white transition-all"
                aria-label={t("newsCloseAria")}
              >
                <X className="size-6" />
              </button>

              {/* Content */}
              <div className="p-6">
                {/* Category and time */}
                <div className="flex items-center gap-3 mb-3">
                  {selectedNews.category && (
                    <span className="px-2 py-1 bg-info/20 text-info text-xs font-medium rounded">
                      {selectedNews.category}
                    </span>
                  )}
                  <div className="flex items-center gap-1 text-white/40 text-xs">
                    <Clock className="size-3" />
                    <span>{formatNewsTime(selectedNews.pubDate)}</span>
                  </div>
                </div>

                {/* Title */}
                <h2 className="text-xl landscape:lg:text-2xl font-semibold text-white mb-4 leading-tight">
                  {selectedNews.title}
                </h2>

                {/* Description */}
                {selectedNews.description && (
                  <p className="text-white/70 text-sm landscape:lg:text-base leading-relaxed mb-6">
                    {selectedNews.description}
                  </p>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => setReaderOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                  >
                    <BookOpen className="size-4" />
                    <span className="text-sm font-medium">{t("newsRead")}</span>
                  </button>
                  <a
                    href={selectedNews.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white/80 rounded-lg transition-colors text-sm"
                    aria-label={t("newsOpenOriginal")}
                  >
                    <ExternalLink className="size-4" />
                  </a>
                  <button
                    onClick={() => setSelectedNews(null)}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white/80 rounded-lg transition-colors text-sm"
                  >
                    {t("newsClose")}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* In-app reader-mode sheet — opens on top of the screensaver
          when the user clicks "Read article". Sanitized HTML, no
          external nav. */}
      <NewsArticleSheet
        url={selectedNews?.link ?? null}
        open={readerOpen}
        onOpenChange={(o) => {
          setReaderOpen(o);
          if (o) handleModalInteraction();
        }}
        fallbackSourceName={selectedNews?.sourceName}
        elevated
      />

      {/* Clock overlay - bottom left (compact for mobile & portrait) */}
      <div
        className="absolute bottom-32 landscape:lg:bottom-12 left-4 landscape:lg:left-12 safe-area-inset screensaver-slide-up"
        style={{ animationDelay: "0.5s", ...burnInStyle }}
      >
        <div className="flex items-baseline">
          <span className="font-display font-light text-7xl landscape:lg:text-[8rem] text-white clock-display tracking-tighter leading-none">
            {hours}
          </span>
          <span className="font-display font-light text-7xl landscape:lg:text-[8rem] text-white/30 mx-1 landscape:lg:mx-2">
            :
          </span>
          <span className="font-display font-light text-7xl landscape:lg:text-[8rem] text-white clock-display tracking-tighter leading-none">
            {minutes}
          </span>
        </div>
        <p className="text-xl landscape:lg:text-2xl font-light text-white/60 mt-2 tracking-wide">
          {formattedDate}
        </p>
      </div>

      {/* Right side - Events and Birthdays (above clock for portrait/mobile, right side for landscape desktop) */}
      <div
        className="absolute bottom-56 left-4 right-4 landscape:lg:bottom-12 landscape:lg:left-auto landscape:lg:right-12 max-w-sm flex flex-col gap-4 landscape:lg:gap-6 safe-area-inset screensaver-slide-right"
        style={{ animationDelay: "0.7s", ...burnInStyle }}
      >
        {/* Upcoming Events */}
        {upcomingEvents.length > 0 && (
          <div className="flex flex-col gap-2 landscape:lg:gap-3">
            <div className="flex items-center gap-2 text-white/60">
              <Calendar className="size-4" />
              <span className="text-xs landscape:lg:text-sm font-medium uppercase tracking-wider">{t("eventsLabel")}</span>
            </div>
            <div className="flex flex-col gap-1.5 landscape:lg:gap-2">
              {upcomingEvents.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center gap-2 landscape:lg:gap-3 bg-black/40 rounded-lg px-3 py-1.5 landscape:lg:px-4 landscape:lg:py-2 gpu-blur"
                >
                  {event.personName ? (
                    <PersonAvatar
                      name={event.personName}
                      color={event.personColor ?? event.color}
                      avatarUrl={event.personAvatar}
                      size={32}
                      className="shrink-0"
                    />
                  ) : (
                    <div
                      className="w-1 h-8 rounded-full shrink-0"
                      style={{ backgroundColor: event.color }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate text-sm">
                      {event.title}
                    </p>
                    <div className="flex items-center gap-2 text-white/50 text-xs">
                      <span>{formatEventTime(event.start, event.allDay, eventLabels, dateLocale, formatTime)}</span>
                      {event.location && (
                        <span className="flex items-center gap-1 truncate">
                          <MapPin className="size-3 shrink-0" />
                          <span className="truncate">{event.location}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming Birthdays */}
        {upcomingBirthdays.length > 0 && (
          <div className="flex flex-col gap-2 landscape:lg:gap-3">
            <div className="flex items-center gap-2 text-white/60">
              <Cake className="size-4" />
              <span className="text-xs landscape:lg:text-sm font-medium uppercase tracking-wider">{t("birthdaysLabel")}</span>
            </div>
            <div className="flex flex-col gap-1.5 landscape:lg:gap-2">
              {upcomingBirthdays.map((birthday) => (
                <div
                  key={birthday.id}
                  className="flex items-center gap-2 landscape:lg:gap-3 bg-black/40 rounded-lg px-3 py-1.5 landscape:lg:px-4 landscape:lg:py-2 gpu-blur"
                >
                  <div
                    className="size-8 rounded-full flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: birthday.daysUntil === 0
                        ? "#ec4899"
                        : birthday.personColor
                          ? `${birthday.personColor}30`
                          : "rgba(255,255,255,0.1)",
                    }}
                  >
                    <Cake
                      className="size-4"
                      style={{
                        color: birthday.daysUntil === 0
                          ? "white"
                          : birthday.personColor || "rgba(255,255,255,0.7)"
                      }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate text-sm">
                      {/* No birth year stored means no age to announce - see hasBirthYear. */}
                      {hasBirthYear(birthday.date)
                        ? t("birthdayTurns", { name: birthday.name, age: calculateUpcomingAge(birthday.date) })
                        : birthday.name}
                    </p>
                    <p className="text-white/50 text-xs">
                      {format(birthday.date, locale === "de" ? "d. MMMM" : "MMMM d", { locale: dateLocale })}
                    </p>
                  </div>
                  <div
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      birthday.daysUntil === 0
                        ? "bg-pink-500 text-white"
                        : birthday.daysUntil <= 7
                        ? "bg-warning/20 text-warning"
                        : "bg-white/10 text-white/70"
                    }`}
                  >
                    {birthday.daysUntil === 0
                      ? t("birthdayToday")
                      : t("birthdayDays", { count: birthday.daysUntil })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Photo indicator - simple counter instead of dots to reduce DOM elements */}
        {photoUrls.length > 1 && (
          <div className="flex justify-end pt-2">
            <span className="text-white/40 text-xs">
              {currentPhotoIndex + 1} / {photoUrls.length}
            </span>
          </div>
        )}
      </div>

      {/* Photo metadata / attribution */}
      {currentPhotoMetadata?.photographer && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 screensaver-fade-in"
          style={{ animationDelay: "1s", ...burnInStyle }}
        >
          <p className="text-white/30 text-xs text-center">
            {/*
              Unsplash's guidelines require crediting Unsplash as well as the
              photographer, and linking back to their profile. Only the name
              was shown before, and photographerUrl was fetched and then
              dropped. On a kiosk nobody taps a screensaver, so the link is
              there to satisfy the requirement and for anyone who does.
            */}
            {currentPhotoMetadata.photographerUrl ? (
              <a
                href={currentPhotoMetadata.photographerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white/60 transition-colors"
              >
                {t("photoCreditUnsplash", { photographer: currentPhotoMetadata.photographer })}
              </a>
            ) : (
              t("photoCredit", { photographer: currentPhotoMetadata.photographer })
            )}
            {currentPhotoMetadata.location && ` · ${currentPhotoMetadata.location}`}
          </p>
        </div>
      )}

      {/* Touch hint */}
      <p
        className="absolute top-8 left-1/2 -translate-x-1/2 text-white/40 text-sm safe-area-inset screensaver-fade-in"
        style={{ animationDelay: "2s", paddingTop: 'env(safe-area-inset-top, 0)', ...burnInStyle }}
      >
        {t("touchHint")}
      </p>
    </div>
  );
}
