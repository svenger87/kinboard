"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  LayoutGrid,
  Cloud,
  Calendar,
  GraduationCap,
  Cake,
  CalendarDays,
  UtensilsCrossed,
  Trash2,
  StickyNote,
  CheckSquare,
  ShoppingCart,
  Car,
  TrendingUp,
  PiggyBank,
  Images,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { useSetting, useUpdateSetting } from "@/hooks";
import { useKeyboardShortcuts, useSwipeNavigation } from "@/hooks";
import { DEFAULT_WIDGET_VISIBILITY } from "@/types/widgets";
import type { WidgetVisibility } from "@/types/widgets";

interface WidgetConfig {
  key: keyof WidgetVisibility;
  labelKey: string;
  descriptionKey: string;
  previewKeys: readonly string[];
  icon: LucideIcon;
}

const WIDGET_CONFIGS: WidgetConfig[] = [
  { key: "weather", labelKey: "weatherLabel", descriptionKey: "weatherDescription", previewKeys: ["weatherPreview1", "weatherPreview2", "weatherPreview3"], icon: Cloud },
  { key: "upcomingEvents", labelKey: "upcomingLabel", descriptionKey: "upcomingDescription", previewKeys: ["upcomingPreview1", "upcomingPreview2", "upcomingPreview3"], icon: Calendar },
  { key: "schedule", labelKey: "scheduleLabel", descriptionKey: "scheduleDescription", previewKeys: ["schedulePreview1", "schedulePreview2", "schedulePreview3"], icon: GraduationCap },
  { key: "birthday", labelKey: "birthdayLabel", descriptionKey: "birthdayDescription", previewKeys: ["birthdayPreview1", "birthdayPreview2", "birthdayPreview3"], icon: Cake },
  { key: "weekOverview", labelKey: "weekOverviewLabel", descriptionKey: "weekOverviewDescription", previewKeys: ["weekOverviewPreview1"], icon: CalendarDays },
  { key: "mealPlan", labelKey: "mealPlanLabel", descriptionKey: "mealPlanDescription", previewKeys: ["mealPlanPreview1", "mealPlanPreview2"], icon: UtensilsCrossed },
  { key: "wasteCollection", labelKey: "wasteLabel", descriptionKey: "wasteDescription", previewKeys: ["wastePreview1", "wastePreview2", "wastePreview3"], icon: Trash2 },
  { key: "tasks", labelKey: "tasksLabel", descriptionKey: "tasksDescription", previewKeys: ["tasksPreview1", "tasksPreview2", "tasksPreview3"], icon: CheckSquare },
  { key: "shopping", labelKey: "shoppingLabel", descriptionKey: "shoppingDescription", previewKeys: ["shoppingPreview1", "shoppingPreview2", "shoppingPreview3"], icon: ShoppingCart },
  { key: "notes", labelKey: "notesLabel", descriptionKey: "notesDescription", previewKeys: ["notesPreview1", "notesPreview2", "notesPreview3"], icon: StickyNote },
  { key: "vehicles", labelKey: "vehiclesLabel", descriptionKey: "vehiclesDescription", previewKeys: ["vehiclesPreview1", "vehiclesPreview2"], icon: Car },
  { key: "stonks", labelKey: "stonksLabel", descriptionKey: "stonksDescription", previewKeys: ["stonksPreview1", "stonksPreview2"], icon: TrendingUp },
  { key: "pocketMoney", labelKey: "pocketMoneyLabel", descriptionKey: "pocketMoneyDescription", previewKeys: ["pocketMoneyPreview1", "pocketMoneyPreview2"], icon: PiggyBank },
  { key: "photos", labelKey: "photosLabel", descriptionKey: "photosDescription", previewKeys: ["photosPreview1", "photosPreview2"], icon: Images },
];

export default function WidgetSettingsPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const t = useTranslations("settings.widgets");

  const { data: visibility, isLoading } = useSetting<WidgetVisibility>(
    "widget_visibility",
    DEFAULT_WIDGET_VISIBILITY
  );
  const updateSetting = useUpdateSetting<WidgetVisibility>();

  const toggleWidget = (key: keyof WidgetVisibility) => {
    const current = visibility ?? DEFAULT_WIDGET_VISIBILITY;
    updateSetting.mutate({
      key: "widget_visibility",
      value: { ...current, [key]: !current[key] },
    });
  };

  const enabledCount = visibility
    ? Object.values(visibility).filter(Boolean).length
    : WIDGET_CONFIGS.length;

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto">
        <PageHeader
          iconSlot={
            <div className="p-2.5 rounded-xl bg-primary/10 shrink-0">
              <LayoutGrid className="size-6 text-primary" strokeWidth={1.5} />
            </div>
          }
          title={t("title")}
          subtitle={t("subtitleCount", { count: enabledCount, total: WIDGET_CONFIGS.length })}
          className="mb-2"
        />

        <p className="text-sm text-muted-foreground mb-6 px-1">
          {t("intro")}
        </p>

        {/* Widget Cards */}
        <div className="flex flex-col gap-3">
          {WIDGET_CONFIGS.map((widget, index) => {
            const enabled = visibility?.[widget.key] ?? true;
            const Icon = widget.icon;
            const label = t(widget.labelKey);

            return (
              <motion.div
                key={widget.key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
              >
                <Card
                  className={`p-4 transition-all duration-200 ${
                    enabled ? "" : "opacity-50"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className={`p-2 rounded-lg shrink-0 ${
                      enabled ? "bg-primary/10" : "bg-muted/20"
                    }`}>
                      <Icon
                        className={`size-5 ${enabled ? "text-primary" : "text-muted-foreground"}`}
                        strokeWidth={1.5}
                      />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-medium">{label}</p>
                        <Switch
                          checked={enabled}
                          onCheckedChange={() => toggleWidget(widget.key)}
                          disabled={isLoading || updateSetting.isPending}
                          aria-label={t("toggleAria", { label, state: enabled ? t("toggleStateHide") : t("toggleStateShow") })}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        {t(widget.descriptionKey)}
                      </p>

                      {/* Preview */}
                      <div className={`rounded-lg border border-border/40 bg-muted/40 px-3 py-2 transition-opacity ${
                        enabled ? "opacity-100" : "opacity-40"
                      }`}>
                        {widget.previewKeys.map((previewKey, i) => (
                          <p key={i} className="text-xs text-muted-foreground/80 truncate leading-relaxed">
                            {t(previewKey)}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
