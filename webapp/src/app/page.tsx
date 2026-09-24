"use client";

import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { Clock } from "@/components/widgets/clock";
import { Weather } from "@/components/widgets/weather";
import { UpcomingEvents } from "@/components/widgets/upcoming-events";
import { FamilyMembers } from "@/components/widgets/family-members";
import { ScheduleWidget } from "@/components/widgets/schedule-widget";
import { BirthdayWidget } from "@/components/widgets/birthday-widget";
import { VehiclesWidget } from "@/components/widgets/vehicles-widget";
import { StonksWidget } from "@/components/widgets/stonks-widget";
import { PhotosWidget } from "@/components/widgets/photos-widget";
import { PocketMoneyWidget } from "@/components/widgets/pocket-money-widget";
import { TimerWidget } from "@/components/widgets/timer-widget";
import { CountdownWidget } from "@/components/widgets/countdown-widget";
import { MediaPlayerWidget } from "@/components/widgets/media-player-widget";
import { MessagesWidget } from "@/components/widgets/messages-widget";
import { MessageTakeover } from "@/components/message-takeover";
import { NotesWidget } from "@/components/widgets/notes-widget";
import { TasksWidget } from "@/components/widgets/tasks-widget";
import { ShoppingWidget } from "@/components/widgets/shopping-widget";
import { WasteCollectionWidget } from "@/components/widgets/waste-collection-widget";
import { MealPlanWidget } from "@/components/widgets/meal-plan-widget";
import { WeekOverviewWidget } from "@/components/widgets/week-overview-widget";
import { TodayStrip } from "@/components/widgets/today-strip";
import { FloatingLightsFab } from "@/components/floating-lights-fab";
import { AttentionWidget } from "@/components/widgets/attention-widget";
import { GettingStartedChecklist } from "@/components/getting-started-checklist";
import { ConnectivityBanner } from "@/components/connectivity-banner";
import { ShoppingInstallPrompt } from "@/components/shopping-install-prompt";
import {
  useKeyboardShortcuts,
  useSwipeNavigation,
  useThemeSettings,
  useSetting,
  usePeople,
  useSchedules,
} from "@/hooks";
import { timetabledChildren } from "@/lib/timetabled-children";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { useHomeLayout } from "@/hooks/use-home-layout";
import { mergeWidgetOrder, useWidgetOrder } from "@/hooks/use-widget-order";
import type { WidgetKey } from "@/hooks/use-widget-order";
import {
  DEFAULT_SCHEDULE_WIDGET_SETTINGS,
  type ScheduleWidgetSettings,
} from "@/types/widgets";
import { DEFAULT_WIDGET_VISIBILITY, DEFAULT_WIDGET_ORDER, migrateLegacyWidgetVisibility } from "@/types/widgets";
import type { WidgetVisibility } from "@/types/widgets";

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  // Load theme settings from Supabase (applies theme CSS class, clock settings)
  const { showSeconds } = useThemeSettings();
  const [homeLayout] = useHomeLayout();
  const [savedWidgetOrder] = useWidgetOrder();

  // Load widget visibility settings
  const { data: widgets } = useSetting<WidgetVisibility>(
    "widget_visibility",
    DEFAULT_WIDGET_VISIBILITY
  );
  // Merge the stored blob over the defaults rather than trusting it as-is.
  // `useSetting` only falls back to `DEFAULT_WIDGET_VISIBILITY` when a family
  // has *no* widget_visibility row at all — any family that has ever saved
  // one has a blob shaped like the widget list on the day they saved it, with
  // no key for anything added since. Read verbatim, a widget added after that
  // save reads as `undefined` (falsy) forever, no matter what its default
  // says, which defeats defaulting a new widget on. A key the blob has never
  // heard of takes its default here; a widget someone deliberately switched
  // off (an explicit `false`) survives the merge unchanged. General fix —
  // every widget added from here on hits this the same way.
  const w = widgets
    ? { ...DEFAULT_WIDGET_VISIBILITY, ...migrateLegacyWidgetVisibility(widgets) }
    : DEFAULT_WIDGET_VISIBILITY;

  // One Stundenplan card per child, from discussion #264: a family with two
  // kids wants both timetables on the wall at once rather than switching
  // between them. Off by default — the single card with its switcher is
  // still the right shape for one child, and for a wall that is already full.
  //
  // Deliberately its own settings row rather than another key in
  // `widget_visibility`: every key in that blob is treated as a widget, and
  // Settings → Widgets counts the true ones against `WIDGET_CONFIGS.length`
  // for its "7 von 17" subtitle. A non-widget boolean in there makes that
  // number quietly wrong.
  const { data: scheduleWidget } = useSetting<ScheduleWidgetSettings>(
    SETTINGS_KEYS.scheduleWidget,
    DEFAULT_SCHEDULE_WIDGET_SETTINGS,
  );
  const perChild = scheduleWidget?.perChild ?? DEFAULT_SCHEDULE_WIDGET_SETTINGS.perChild;

  // Both already cached for the dashboard's other widgets: `useSchedules()`
  // with no argument is the whole family's rows in one query, the same one
  // the nav visibility check reads.
  const { data: people } = usePeople();
  const { data: schedules } = useSchedules();
  const perChildCards =
    w.schedule && perChild ? timetabledChildren(people, schedules) : [];
  const widgetCards: Record<WidgetKey, React.ReactNode> = {
    weather: <Weather />,
    upcomingEvents: <UpcomingEvents maxEvents={3} />,
    schedule: perChildCards.length > 0
      ? perChildCards.map((child) => <ScheduleWidget key={child.id} personId={child.id} />)
      : <ScheduleWidget />,
    birthday: <BirthdayWidget maxItems={3} />,
    weekOverview: <WeekOverviewWidget className="sm:col-span-2" />,
    mealPlan: <MealPlanWidget />,
    wasteCollection: <WasteCollectionWidget maxItems={3} />,
    tasks: <TasksWidget maxItems={4} />,
    shopping: <ShoppingWidget maxItems={4} />,
    notes: <NotesWidget maxItems={3} />,
    vehicles: <VehiclesWidget />,
    stonks: <StonksWidget />,
    pocketMoney: <PocketMoneyWidget />,
    photos: <PhotosWidget />,
    timers: <TimerWidget />,
    media: <MediaPlayerWidget />,
    messages: <MessagesWidget />,
    countdown: <CountdownWidget />,
  };
  const widgetKeys = mergeWidgetOrder(DEFAULT_WIDGET_ORDER, savedWidgetOrder);

  // Enable keyboard shortcuts for navigation
  useKeyboardShortcuts();

  // Enable swipe navigation on touch devices
  useSwipeNavigation();

  return (
    // No `min-h-page` here: the inner container already sets
    // `calc(100vh - var(--nav-spacing))`, and PageShell adds the nav height back
    // as padding. Stacking all three made every page exactly one nav-height
    // taller than its viewport, so pages that fit still scrolled (audit KB-21).
    <main id="main-content" className="relative overflow-hidden hide-status-bar">
      <div className="page-gradient pointer-events-none fixed inset-0 z-0" />
      {/* `has-fab` reserves a corner's worth of space at the end of the column
          so the floating lights button stops sitting on top of the last
          widget's content (audit KB-04). */}
      <div
        className="has-fab relative z-10 flex flex-col p-4 md:p-6 lg:p-8 safe-area-inset"
        style={{ minHeight: "calc(100vh - var(--nav-spacing))" }}
      >
        <h1 className="sr-only">{t("ariaWidgets")}</h1>
        <ConnectivityBanner />
        <GettingStartedChecklist />
        <ShoppingInstallPrompt />
        {/* Top Section - Clock.
            `flex-1` used to let this block absorb all spare height, which is
            right in portrait and wrong in landscape: on a 1920x1080 panel it
            took 47% of the height (clock + five names + one event pill) and
            pushed the second widget row off the bottom — scrollHeight 1754 vs
            clientHeight 1080 (audit KB-01). Capping it at 38vh on short, wide
            viewports keeps the hero dominant without letting it crowd out the
            family information the dashboard exists to show. Portrait is
            deliberately untouched: it already fits. */}
        <section
          className={`relative z-[1] flex items-center justify-center hero-block ${homeLayout === "compact" ? "flex-col portrait:md:grid portrait:md:grid-cols-2 portrait:md:gap-6 py-4" : "flex-1 flex-col"}`}
          aria-label={t("ariaClock")}
        >
          <div className={homeLayout === "compact" ? "min-w-0 text-center" : "contents"}>
            <Clock size={homeLayout === "compact" ? "lg" : "xl"} showDate showSeconds={showSeconds} showGreeting />
          </div>
          <div className={homeLayout === "compact" ? "min-w-0" : "contents"}>
            <div className={homeLayout === "compact" ? "" : "mt-6 lg:mt-10"}>
              <FamilyMembers className={homeLayout === "compact" ? "flex-wrap" : ""} />
            </div>
            <div className="mt-4 mb-4 w-full lg:mb-6">
              <TodayStrip />
            </div>
          </div>
        </section>

        {/* Widget grid — 2 columns on a portrait kiosk, up to 6 on a wide one.
            `max-w-7xl` capped this at 1280px regardless of panel size: on a
            2560px kiosk that left 640px of dead margin per side while the cards
            inside were narrow enough to wrap "16° / 12°" (audit KB-02). A
            reading-measure cap belongs on prose, not a dashboard.

            `[&>*]:h-full` used to stretch every card to its row's height so
            neighbours matched. That is what turned a short card next to a tall
            one into a visible hole — most obviously the unconfigured Stundenplan
            widget, which left a ~500x230px void beside it (KB-06). Cards now
            take their natural height, `auto-rows-min` sizes rows to content and
            `items-start` keeps them top-aligned, so the grid packs instead.

            Width is `w-full max-w-[2200px]`, not `w-[min(96vw,2200px)]`. The
            viewport unit measured the window while this grid sits inside a
            wrapper that already has `p-4`, so it asked for 96vw against a
            content box of `100vw - 32px`. Anything narrower than 800px made
            96vw the larger of the two, `mx-auto` cannot centre a child wider
            than its container, and the grid pinned left and ran under the
            right-hand padding — every card flush to the screen edge and clipped
            by main's `overflow-hidden`. Measured at 390px: cards sat 16px from
            the left and 0px from the right. It fits on a wide panel, which is
            why only phones showed it. `w-full` inherits the padding the wrapper
            already applies, and the 2200px cap it was given for a big kiosk is
            unchanged. */}
        {/* Above the grid, not inside it, and gated on the same visibility flag
            as the widget: a screen with messages switched off is not one of
            the screens being talked to (RFC-005 §6). */}
        {w.messages && <MessageTakeover />}

        <section className="relative z-[1] mt-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 portrait:lg:grid-cols-2 2xl:grid-cols-5 min-[2000px]:grid-cols-6 auto-rows-min items-start gap-4 md:gap-6 w-full max-w-[2200px] mx-auto" aria-label={t("ariaWidgets")}>
          <FloatingLightsFab />
          {/* First, and across the whole width: this is what the family has to
              act on, and it renders nothing at all when there is nothing — so
              it costs no space on a quiet day and cannot become wallpaper.
              Deliberately not behind a visibility toggle: individual hints are
              switched off from themselves, which is the finer control. */}
          <AttentionWidget />
          {widgetKeys.filter((key) => w[key]).map((key) => <Fragment key={key}>{widgetCards[key]}</Fragment>)}
        </section>
      </div>
    </main>
  );
}
