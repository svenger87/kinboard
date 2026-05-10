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
import { WasteCollectionWidget } from "@/components/widgets/waste-collection-widget";
import { MealPlanWidget } from "@/components/widgets/meal-plan-widget";
import { WeekOverviewWidget } from "@/components/widgets/week-overview-widget";
import { TodayStrip } from "@/components/widgets/today-strip";
import { FloatingLightsFab } from "@/components/floating-lights-fab";
import { SetupBanner } from "@/components/setup-banner";
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
    <main id="main-content" className="min-h-screen relative overflow-hidden hide-status-bar">
      <div
        className="relative z-10 flex flex-col p-4 md:p-6 lg:p-8 safe-area-inset"
        style={{ minHeight: "calc(100vh - var(--nav-spacing))" }}
      >
        <SetupBanner />
        <ShoppingInstallPrompt />
        {/* Background gradient - z-0 to stay behind content */}
        <div className="fixed inset-0 z-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />
        {/* Radial glow behind clock area - static radial gradient (no blur, no animation) for ARM GPU compat */}
        <div className="fixed top-[15%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] z-0 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, hsl(var(--month-primary) / 0.04) 0%, transparent 70%)' }} />
        {/* Top Section - Clock */}
        <section className="relative z-[1] flex-1 flex flex-col items-center justify-center" aria-label={t("ariaClock")}>
          <Clock size="xl" showDate showSeconds={showSeconds} showGreeting />

          {/* Family Members below clock */}
          <div className="mt-12">
            <FamilyMembers />
          </div>

          {/* Today at a glance - compact summary. mb-12 mirrors the
              mt-12 above FamilyMembers so TodayStrip has breathing
              room from the widget grid below (otherwise it sits flush
              against the cards on portrait/short viewports). */}
          <div className="mt-6 mb-12">
            <TodayStrip />
          </div>
        </section>

        {/* Bottom Section - Widgets Grid - 2x2 for portrait kiosk, 4 cols for landscape */}
        <section className="relative z-[1] mt-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 portrait:lg:grid-cols-2 gap-4 md:gap-6 max-w-7xl mx-auto w-full" aria-label={t("ariaWidgets")}>
          {w.weather && <Weather />}
          {w.upcomingEvents && <UpcomingEvents maxEvents={3} />}
          {w.schedule && <ScheduleWidget />}
          {w.birthday && <BirthdayWidget maxItems={3} />}
          {w.weekOverview && <WeekOverviewWidget className="sm:col-span-2" />}
          {w.mealPlan && <MealPlanWidget />}
          {w.wasteCollection && <WasteCollectionWidget maxItems={3} />}
          {w.tasks && <TasksWidget maxItems={4} />}
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
