"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { useScreensaverData } from "@/hooks/use-screensaver-data";
import { ScreensaverDataProvider, useScreensaverDataValue } from "@/components/layouts/screensaver-data-context";
import { BirthdayRow, EnergyRows, EventRow, NewsCard, SectionLabel, TeslaRows, useEventWhen, useNewsTime } from "@/components/screensaver-rows";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { type NewsItem } from "@/hooks";
import { useScreensaverSettings } from "@/hooks/use-screensaver-settings";
import { NewsArticleSheet } from "@/components/news-article-sheet";
import { Cake, Calendar, Newspaper, X, ExternalLink, BookOpen, Clock } from "lucide-react";
import { choosePhotoFit, aspectOf } from "@/lib/photo-fit";
import { WeatherEffects } from "@/components/weather-effects";
import { ScreensaverWeather } from "@/components/screensaver-weather";
import { ScreensaverLessons } from "@/components/screensaver-lessons";
import { CreaturesOnIdle } from "@/components/creatures-on-home";
import { useFitToWidth, useMediaQuery } from "@/hooks/use-fit-to-width";

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



/**
 * One photo layer, fitted to the screen rather than always cropped to it.
 *
 * `object-cover` was unconditional here, so on a 16:9 wall panel a portrait
 * phone photo was cropped to its middle third — the faces gone. It stays the
 * right default: a 4:3 holiday picture on a television should fill it.
 * `choosePhotoFit` decides which case this is (RFC-009 §3.4).
 *
 * The contained case sits on the black the screensaver already paints. The
 * obvious alternative — a blurred copy of the photo behind it, the way a phone
 * gallery does it — is banned by eslint.config.mjs, because compositing a
 * full-screen blur for hours on an ARM panel is exactly what kiosk surfaces
 * must not do.
 *
 * Dimensions come from the source where it knows them, which today means the
 * uploaded library. For Immich, Unsplash, DLNA and iCloud the browser measures
 * the image on load instead, so all five sources get this rather than only the
 * one that stores a width.
 */
function ScreensaverPhotoLayer({
  src,
  photoAspect,
  viewportAspect,
  className,
}: {
  src: string;
  photoAspect: number | null;
  viewportAspect: number;
  className: string;
}) {
  const [measuredAspect, setMeasuredAspect] = useState<number | null>(null);
  const aspect = photoAspect ?? measuredAspect;
  // An unknown shape keeps the behaviour this had before: fill the screen.
  const fit = aspect === null ? "cover" : choosePhotoFit(aspect, viewportAspect);

  return (
    <img
      src={src}
      alt=""
      decoding="async"
      onLoad={(event) => {
        if (photoAspect !== null) return;
        const img = event.currentTarget;
        const natural = aspectOf(img.naturalWidth, img.naturalHeight);
        if (natural !== null) setMeasuredAspect(natural);
      }}
      className={`absolute inset-0 size-full ${
        fit === "contain" ? "object-contain" : "object-cover"
      } ${className}`}
    />
  );
}

export function Screensaver({ photos }: ScreensaverProps) {
  const t = useTranslations("components.screensaver");
  const eventWhen = useEventWhen();
  const formatNewsTime = useNewsTime();

  const { settings: screensaverSettings } = useScreensaverSettings();
  const largeDetails = screensaverSettings.largeDetails ?? false;
  // One gap between the sections of the bottom stack (events, birthdays, the
  // clock), so the spacing is even: it was 16px between the lists and 24px
  // above the clock (#282). Wider with the large details, as the text is.
  const sectionGap = largeDetails ? "gap-10" : "gap-6";
  const rowScale = largeDetails ? "large" : "normal";

  // The data comes from one hook, called once here (it also runs the photo
  // rotation), and handed to the layout widgets through the context below.
  const data = useScreensaverData({ photos });
  const screensaverData = useScreensaverDataValue(data);
  const {
    hours, minutes, nightNow, formattedDate, soon, weather,
    upcomingEvents, upcomingBirthdays, news,
    showEnergyWidget, showTeslaWidget, solarPower, batterySoc, gridPower,
    teslaBattery, teslaRange, teslaChargingRate,
    photoUrls, photoIndex: currentPhotoIndex, previousPhotoIndex,
    currentBlobUrl, previousBlobUrl, aspectAt, currentPhotoMetadata,
  } = data;
  // The screen's own shape, which decides whether a photo is cropped or
  // letterboxed. Kinboard runs on portrait wall panels as well as landscape
  // ones, and a tablet gets rotated, so this is measured rather than assumed.
  const [viewportAspect, setViewportAspect] = useState(16 / 9);
  useEffect(() => {
    const measure = () =>
      setViewportAspect(window.innerWidth / Math.max(1, window.innerHeight));
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const [modalLastInteraction, setModalLastInteraction] = useState<number>(0);

  const showForecast = screensaverSettings.showForecast ?? false;
  const showLessons = screensaverSettings.showLessons ?? false;
  const weatherEffects = screensaverSettings.weatherEffects ?? false;



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

  // The news list stops above whatever sits below it on the screen (the
  // clock, and the events where they share its column): it used to run down
  // to 60vh and over a large clock on a short landscape panel, worse with the
  // line under the clock. Measured, since the blocks below change height.
  const newsListRef = useRef<HTMLDivElement>(null);
  const clockBlockRef = useRef<HTMLDivElement>(null);
  const eventsBlockRef = useRef<HTMLDivElement>(null);
  // The news list shares the top of the screen with the weather column. Its
  // width used to ignore how wide the weather is: with the forecast on, a
  // portrait screen at 720px ran the news 37px under it (screen matrix).
  // Now it ends 24px before the weather, and where that leaves less than
  // 16rem it moves below the weather instead, at the full width.
  const [weatherBox, setWeatherBox] = useState<{ w: number; h: number; vw: number } | null>(null);
  // A callback ref: the column is not rendered at night, so an effect run
  // once on mount would miss it when the night ends.
  const weatherObserver = useRef<{ ro: ResizeObserver; off: () => void } | null>(null);
  const weatherColumnRef = useCallback((el: HTMLDivElement | null) => {
    weatherObserver.current?.ro.disconnect();
    weatherObserver.current?.off();
    weatherObserver.current = null;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth };
      setWeatherBox((prev) => (prev && prev.w === next.w && prev.h === next.h && prev.vw === next.vw ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    weatherObserver.current = { ro, off: () => window.removeEventListener("resize", measure) };
  }, []);
  const SAVER_EDGE = 48;
  const NEWS_MAX = 400; // 25rem
  const newsBeside = weatherBox ? weatherBox.vw - 2 * SAVER_EDGE - (weatherBox.w ? weatherBox.w + 24 : 0) : NEWS_MAX;
  const newsUnder = weatherBox !== null && weatherBox.w > 0 && newsBeside < 256;
  const newsStyle = newsUnder
    ? { top: SAVER_EDGE + weatherBox!.h + 24, width: Math.min(NEWS_MAX, weatherBox!.vw - 2 * SAVER_EDGE) }
    : { width: Math.min(NEWS_MAX, newsBeside) };
  // On a portrait screen the time is exactly as wide as the event and
  // birthday cards above it (#282): measured, since the digits have the
  // display font's own widths. The cards keep their own width (max-w-sm, or
  // 36rem with the large details); the clock follows them, not the screen.
  const clockDigitsRef = useRef<HTMLDivElement>(null);
  const portrait = useMediaQuery("(orientation: portrait)");
  const fitted = useFitToWidth(eventsBlockRef, [{ ref: clockDigitsRef }], portrait, [hours, minutes, largeDetails]);
  const clockFit = portrait ? fitted?.[0] || (largeDetails ? 128 : 72) : null;
  // On portrait the spans inherit the fitted size from the row: the hook
  // measures by setting a probe size on the row itself.
  const clockSize = portrait
    ? ""
    : largeDetails
      ? "text-[clamp(4.5rem,16vw,8rem)] landscape:lg:text-[11rem]"
      : "text-7xl landscape:lg:text-[8rem]";
  const [newsRoom, setNewsRoom] = useState<number | null>(null);
  const [newsClipped, setNewsClipped] = useState(false);
  useEffect(() => {
    const list = newsListRef.current;
    if (!list) return;
    const measure = () => {
      const box = list.getBoundingClientRect();
      let floor = window.innerHeight;
      for (const el of [clockBlockRef.current, eventsBlockRef.current]) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.right <= box.left || r.left >= box.right) continue;
        floor = Math.min(floor, r.top);
      }
      const room = Math.max(0, Math.floor(floor - 24 - box.top));
      setNewsRoom(room);
      // Cut short: fade the last card out rather than slicing it.
      setNewsClipped(list.scrollHeight > Math.min(room, window.innerHeight * 0.6) + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of [list, clockBlockRef.current, eventsBlockRef.current]) if (el) ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [news, screensaverSettings.showNews, soon, largeDetails, selectedNews]);

  // Night: no photo, no news, no events, the clock alone and dim, drifting
  // with the burn-in offsets like everything else here. A touch wakes the
  // screen as always (the screensaver gate listens on the document).
  if (nightNow) {
    return (
      <ScreensaverDataProvider value={screensaverData}>
        <div className="fixed inset-0 z-[100] bg-black screensaver-fade-in" data-testid="screensaver-night">
          <div className="absolute inset-0 flex items-center justify-center" style={burnInStyle}>
            <span className="font-display font-light text-white/35 clock-display tracking-tighter leading-none text-[clamp(5rem,18vw,12rem)]">
              {hours}
              <span className="mx-1 text-white/20 landscape:lg:mx-2">:</span>
              {minutes}
            </span>
          </div>
          {/* Asleep along the bottom, faint (RFC-021 §3.4). */}
          <CreaturesOnIdle dim />
        </div>
      </ScreensaverDataProvider>
    );
  }

  return (
    <ScreensaverDataProvider value={screensaverData}>
      <div
        className={`fixed inset-0 z-[100] screensaver-fade-in ${
          currentBlobUrl ? "bg-black" : "screensaver-canvas-empty"
        }`}
      >
        {/* Background Photo - Only render current and previous for performance */}
        <div className="absolute inset-0">
          {/* Previous photo (fading out) */}
          {previousBlobUrl && previousPhotoIndex !== currentPhotoIndex && (
            <ScreensaverPhotoLayer
              key={`prev-${previousPhotoIndex}`}
              src={previousBlobUrl}
              photoAspect={aspectAt(previousPhotoIndex)}
              viewportAspect={viewportAspect}
              className="screensaver-photo screensaver-photo-out"
            />
          )}
          {/* Current photo (fading in) */}
          {currentBlobUrl && (
            <ScreensaverPhotoLayer
              key={`curr-${currentPhotoIndex}`}
              src={currentBlobUrl}
              photoAspect={aspectAt(currentPhotoIndex)}
              viewportAspect={viewportAspect}
              className="screensaver-photo screensaver-photo-in"
            />
          )}

          {/* Gradient overlay for readability */}
          {currentBlobUrl && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40" />
          )}
        </div>

        {/* The weather effects, when switched on for the screensaver (#282),
            and a festival's visitor (RFC-020): above the photo, below the clock
            and everything else here. The visitor's passes move pixels against
            burn-in alongside BURN_IN_OFFSETS. With the effects off this is the
            visitor alone, as before. */}
        <WeatherEffects placement="screensaver" enabled={weatherEffects} />

        {/* The children's creatures along the bottom edge (RFC-021 §3.1), above
            the photo and under everything that reads. The clock and the events
            are lifted by the floor's height (--idle-creature-floor). */}
        <CreaturesOnIdle />

        {/* News list - top left (always rendered for data-no-wake) */}
        {(screensaverSettings.showNews ?? true) && news && news.length > 0 && (
          <div
            className={`absolute top-12 left-12 w-[min(25rem,55vw)] screensaver-slide-down ${selectedNews ? 'opacity-0 pointer-events-none' : ''}`}
            style={{ animationDelay: "0.8s", backgroundColor: "rgba(0,0,0,0.001)", ...newsStyle, ...burnInStyle }}
            data-no-wake
            data-saver-block="news"
          >
            <SectionLabel icon={Newspaper} label={t("newsLabel")} scale="normal" className="mb-3" />
            <div
              ref={newsListRef}
              className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto scrollbar-hide"
              style={{
                ...(newsRoom !== null ? { maxHeight: `min(60vh, ${newsRoom}px)` } : {}),
                ...(newsClipped ? { maskImage: "linear-gradient(to bottom, black calc(100% - 3rem), transparent)", WebkitMaskImage: "linear-gradient(to bottom, black calc(100% - 3rem), transparent)" } : {}),
              }}
            >
              {news.slice(0, 6).map((item) => (
                <NewsCard key={item.link} item={item} time={formatNewsTime(item.pubDate)} scale="normal" onSelect={setSelectedNews} />
              ))}
            </div>
          </div>
        )}

        {/*
          Top right, one column: the weather (with the forecast strip when it is
          on, #282) and under it the energy and Tesla widget. They used to sit at
          fixed offsets from the top, which a taller weather block would run into.
        */}
        <div
          ref={weatherColumnRef}
          className="absolute top-12 right-12 flex flex-col items-end gap-3"
          style={burnInStyle}
          data-saver-block="weather"
        >
        {/* Weather - renders nothing when weather is unconfigured */}
        {weather && (
          <div className="screensaver-slide-down" style={{ animationDelay: "0.85s" }}>
            <ScreensaverWeather weather={weather} showForecast={showForecast} large={largeDetails} />
          </div>
        )}

        {/* Energy + Tesla widget (if either enabled) */}
        {(showEnergyWidget || showTeslaWidget) && (
          <div
            className="screensaver-slide-down"
            style={{ animationDelay: "0.9s" }}
          >
            <div className="bg-black/50 rounded-xl p-4 flex flex-col gap-3 gpu-blur">
              {showEnergyWidget && (
                <EnergyRows solarPower={solarPower} batterySoc={batterySoc} gridPower={gridPower} scale="normal" />
              )}

              {/* Divider between energy and Tesla */}
              {showEnergyWidget && showTeslaWidget && (
                <div className="border-t border-white/10" />
              )}

              {showTeslaWidget && (
                <TeslaRows teslaBattery={teslaBattery} teslaRange={teslaRange} teslaChargingRate={teslaChargingRate} scale="normal" />
              )}
            </div>
          </div>
        )}
        </div>
        {/* end top right */}

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
                className="modal-safe-area relative bg-zinc-900 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto elev-lg"
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

        {/*
          Bottom cluster: the clock and the events/birthdays block.

          On a landscape desktop panel these sit in opposite corners and never
          meet, so each keeps its own absolute position and the wrapper below
          dissolves (`display: contents`).

          Everywhere else — portrait wall panels, and landscape under `lg` — they
          stack, and they used to do it by each anchoring itself to the bottom
          edge with a hand-picked offset: the clock at `bottom-32` (128px) and
          the block at `bottom-56` (224px), i.e. 96px reserved for a clock that
          actually renders 108px tall. It overlapped the last event card by 12px,
          and the reserved figure was a guess that any change to the date string,
          the locale or the font size would invalidate again.

          One flow container with a real gap cannot be off by 12px, so the
          spacing stops being a number anybody has to maintain. `flex-col-reverse`
          keeps the events above the clock without moving either block in the
          source — DOM order is what the landscape layout reads.
        */}
        <div
          className={`absolute inset-x-12 bottom-[calc(3rem+var(--idle-creature-floor,0px))] flex flex-col-reverse ${sectionGap} landscape:lg:contents`}
        >
        {/* Clock overlay - bottom left (compact for mobile & portrait). A festival's fireworks go up over it (RFC-020). */}
        <div
          ref={clockBlockRef}
          data-festival-anchor="screensaver-clock"
          data-saver-block="clock"
          className="landscape:lg:absolute landscape:lg:bottom-[calc(3rem+var(--idle-creature-floor,0px))] landscape:lg:left-12 screensaver-slide-up"
          style={{ animationDelay: "0.5s", ...burnInStyle }}
        >
          <div
            ref={clockDigitsRef}
            className="flex w-fit items-baseline"
            style={clockFit ? { fontSize: clockFit } : undefined}
            data-testid="screensaver-clock-digits"
          >
            <span className={`font-display font-light ${clockSize} text-white clock-display tracking-tighter leading-none`}>
              {hours}
            </span>
            <span className={`font-display font-light ${clockSize} text-white/30 ${clockFit ? "mx-[0.03em]" : "mx-1 landscape:lg:mx-2"} leading-none`}>
              :
            </span>
            <span className={`font-display font-light ${clockSize} text-white clock-display tracking-tighter leading-none`}>
              {minutes}
            </span>
          </div>
          <p className={`${largeDetails ? "text-2xl landscape:lg:text-4xl" : "text-xl landscape:lg:text-2xl"} font-light text-white/60 mt-2 tracking-wide`}>
            {formattedDate}
          </p>
          {soon && (
            <p
              className={`mt-3 inline-block max-w-full truncate rounded-lg bg-white/15 px-3 py-1 font-semibold text-white ${largeDetails ? "text-2xl landscape:lg:text-3xl" : "text-lg landscape:lg:text-xl"}`}
              data-testid="screensaver-next-event"
              data-child={soon.child ? "true" : "false"}
            >
              {t(soon.child ? "nextEventChild" : "nextEventAdult", { title: soon.title, minutes: soon.minutes })}
            </p>
          )}
        </div>

        {/* Right side - Events and Birthdays (above clock for portrait/mobile, right side for landscape desktop) */}
        <div
          ref={eventsBlockRef}
          data-saver-block="events"
          className={`max-w-sm landscape:lg:absolute landscape:lg:bottom-[calc(3rem+var(--idle-creature-floor,0px))] landscape:lg:right-12 flex flex-col ${sectionGap} screensaver-slide-right`}
          style={{ animationDelay: "0.7s", maxWidth: largeDetails ? "36rem" : undefined, ...burnInStyle }}
        >
          {/* Upcoming Events */}
          {upcomingEvents.length > 0 && (
            <div className="flex flex-col gap-2 landscape:lg:gap-3">
              <SectionLabel icon={Calendar} label={t("eventsLabel")} scale={rowScale} />
              <div className="flex flex-col gap-1.5 landscape:lg:gap-2">
                {upcomingEvents.map((event) => (
                  <EventRow key={event.id} event={event} when={eventWhen(event)} scale={rowScale} />
                ))}
              </div>
            </div>
          )}

          {/* Upcoming Birthdays */}
          {upcomingBirthdays.length > 0 && (
            <div className="flex flex-col gap-2 landscape:lg:gap-3">
              <SectionLabel icon={Cake} label={t("birthdaysLabel")} scale={rowScale} />
              <div className="flex flex-col gap-1.5 landscape:lg:gap-2">
                {upcomingBirthdays.map((birthday) => (
                  <BirthdayRow key={birthday.id} birthday={birthday} scale={rowScale} />
                ))}
              </div>
            </div>
          )}

          {/* The children's lessons and what to bring (#282). */}
          {showLessons && <ScreensaverLessons large={largeDetails} />}

        </div>
        </div>
        {/* end bottom cluster */}

        {/* Photo indicator - simple counter instead of dots to reduce DOM elements.
            In the bottom corner rather than under the birthdays, where it added
            a line to the stack and made the gap above the clock uneven (#282). */}
        {photoUrls.length > 1 && (
          <span
            className="absolute bottom-4 right-4 text-white/40 text-xs safe-area-inset screensaver-fade-in"
            style={{ animationDelay: "1s", ...burnInStyle }}
            data-testid="screensaver-photo-count"
          >
            {currentPhotoIndex + 1} / {photoUrls.length}
          </span>
        )}

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

        {/* Touch hint. Not with the forecast on: centred at the top, it ran into
            the forecast strip on portrait panels and on 1024px landscape ones. */}
        {!(showForecast && weather) && (
        <p
          className="absolute top-8 left-1/2 -translate-x-1/2 text-white/40 text-sm safe-area-inset screensaver-fade-in"
          style={{ animationDelay: "2s", paddingTop: 'env(safe-area-inset-top, 0)', ...burnInStyle }}
        >
          {t("touchHint")}
        </p>
        )}
      </div>
    </ScreensaverDataProvider>
  );
}
