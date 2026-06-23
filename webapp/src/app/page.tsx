"use client";

import { useTranslations } from "next-intl";
import { Clock } from "@/components/widgets/clock";
import { Weather } from "@/components/widgets/weather";
import { UpcomingEvents } from "@/components/widgets/upcoming-events";
import { FamilyMembers } from "@/components/widgets/family-members";
import { ScheduleWidget } from "@/components/widgets/schedule-widget";
import { BirthdayWidget } from "@/components/widgets/birthday-widget";
import { VehiclesWidget } from "@/components/widgets/vehicles-widget";
import { StonksWidget } from "@/components/widgets/stonks-widget";
import { PocketMoneyWidget } from "@/components/widgets/pocket-money-widget";
import { NotesWidget } from "@/components/widgets/notes-widget";
import { TasksWidget } from "@/components/widgets/tasks-widget";
import { ShoppingWidget } from "@/components/widgets/shopping-widget";
import { WasteCollectionWidget } from "@/components/widgets/waste-collection-widget";
import { MealPlanWidget } from "@/components/widgets/meal-plan-widget";
import { WeekOverviewWidget } from "@/components/widgets/week-overview-widget";
import { TodayStrip } from "@/components/widgets/today-strip";
import { FloatingLightsFab } from "@/components/floating-lights-fab";
import { GettingStartedChecklist } from "@/components/getting-started-checklist";
import { ShoppingInstallPrompt } from "@/components/shopping-install-prompt";
import { useKeyboardShortcuts, useSwipeNavigation, useThemeSettings, useSetting } from "@/hooks";
import { DEFAULT_WIDGET_VISIBILITY, migrateLegacyWidgetVisibility } from "@/types/widgets";
import type { WidgetVisibility } from "@/types/widgets";

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  // Load theme settings from Supabase (applies theme CSS class, clock settings)
  const { showSeconds } = useThemeSettings();

  // Load widget visibility settings
  const { data: widgets } = useSetting<WidgetVisibility>(
    "widget_visibility",
    DEFAULT_WIDGET_VISIBILITY
  );
  const w = widgets ? migrateLegacyWidgetVisibility(widgets) : DEFAULT_WIDGET_VISIBILITY;

  // Enable keyboard shortcuts for navigation
  useKeyboardShortcuts();

  // Enable swipe navigation on touch devices
  useSwipeNavigation();

  return (
    <main id="main-content" className="relative min-h-screen overflow-hidden hide-status-bar">
      <div className="page-gradient pointer-events-none fixed inset-0 z-0" />
      <div
        className="relative z-10 flex flex-col p-4 md:p-6 lg:p-8 safe-area-inset"
        style={{ minHeight: "calc(100vh - var(--nav-spacing))" }}
      >
        <GettingStartedChecklist />
        <ShoppingInstallPrompt />
        {/* Top Section - Clock */}
        <section className="relative z-[1] flex-1 flex flex-col items-center justify-center" aria-label={t("ariaClock")}>
          <Clock size="xl" showDate showSeconds={showSeconds} showGreeting />

          {/* Family Members below clock */}
          <div className="mt-10">
            <FamilyMembers />
          </div>

          {/* Today at a glance — horizontal pill row */}
          <div className="mt-6 mb-10 w-full">
            <TodayStrip />
          </div>
        </section>

        {/* Bottom Section - Widgets Grid - 2x2 for portrait kiosk, 4 cols
            for landscape. `[&>*]:h-full` makes every direct child fill
            its grid cell so widgets in the same row visually match the
            tallest one — no more uneven gaps. Each widget root is
            responsible for stretching its inner card via `h-full
            flex flex-col`. */}
        <section className="relative z-[1] mt-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 portrait:lg:grid-cols-2 gap-4 md:gap-6 max-w-7xl mx-auto w-full [&>*]:h-full" aria-label={t("ariaWidgets")}>
          {w.weather && <Weather />}
          {w.upcomingEvents && <UpcomingEvents maxEvents={3} />}
          {w.schedule && <ScheduleWidget />}
          {w.birthday && <BirthdayWidget maxItems={3} />}
          {w.weekOverview && <WeekOverviewWidget className="sm:col-span-2" />}
          {w.mealPlan && <MealPlanWidget />}
          {w.wasteCollection && <WasteCollectionWidget maxItems={3} />}
          {w.tasks && <TasksWidget maxItems={4} />}
          {w.shopping && <ShoppingWidget maxItems={4} />}
          {w.notes && <NotesWidget maxItems={3} />}
          {w.vehicles && <VehiclesWidget />}
          {w.stonks && <StonksWidget />}
          {w.pocketMoney && <PocketMoneyWidget />}
        </section>
      </div>

      <FloatingLightsFab />
    </main>
  );
}
