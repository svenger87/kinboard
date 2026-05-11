"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Trash2, Recycle, Newspaper, Leaf, Package, ChevronRight } from "lucide-react";
import { format, isToday, isTomorrow, addDays, startOfDay, endOfDay, differenceInCalendarDays } from "date-fns";
import { de, enUS } from "date-fns/locale";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Link from "next/link";
import { useEvents } from "@/hooks";
import type { LucideIcon } from "lucide-react";

// Waste bin types: keywords match against German calendar event titles
// (a Phase 2d task to generalize), but display labels are resolved
// per-locale via t("wasteCollectionWidget.types.{id}").
type WasteTypeId = "rest" | "bio" | "paper" | "recyclable" | "packaging";

const WASTE_TYPES: {
  id: WasteTypeId;
  keywords: string[];
  icon: LucideIcon;
  color: string;
  bgColor: string;
}[] = [
  {
    id: "rest",
    keywords: ["restabfall", "restmüll", "schwarze tonne", "graue tonne"],
    icon: Trash2,
    color: "#6b7280",
    bgColor: "#6b728015",
  },
  {
    id: "bio",
    keywords: ["bioabfall", "biotonne", "biomüll", "grüne tonne"],
    icon: Leaf,
    color: "#22c55e",
    bgColor: "#22c55e15",
  },
  {
    id: "paper",
    keywords: ["papier", "pappe", "altpapier", "blaue tonne"],
    icon: Newspaper,
    color: "#3b82f6",
    bgColor: "#3b82f615",
  },
  {
    id: "recyclable",
    keywords: ["wertstoff", "gelbe tonne", "gelber sack", "verpackung"],
    icon: Recycle,
    color: "#eab308",
    bgColor: "#eab30815",
  },
  {
    id: "packaging",
    keywords: ["leichtverpackung"],
    icon: Package,
    color: "#f97316",
    bgColor: "#f9731615",
  },
];

function detectWasteType(title: string) {
  const lower = title.toLowerCase();
  for (const wasteType of WASTE_TYPES) {
    for (const keyword of wasteType.keywords) {
      if (lower.includes(keyword)) {
        return wasteType;
      }
    }
  }
  return null;
}

function WasteCollectionSkeleton() {
  const t = useTranslations("wasteCollectionWidget");
  return (
    <Card aria-label={t("loadingAria")} aria-busy="true">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-5 w-28" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-14 rounded-xl" />
      </CardContent>
    </Card>
  );
}

interface WasteCollectionWidgetProps {
  maxItems?: number;
  className?: string;
}

export function WasteCollectionWidget({
  maxItems = 4,
  className = "",
}: WasteCollectionWidgetProps) {
  const t = useTranslations("wasteCollectionWidget");
  const locale = useLocale();
  const dateLocale = locale === "de" ? de : enUS;
  const wasteLabels: Record<WasteTypeId, string> = {
    rest: t("types.rest"),
    bio: t("types.bio"),
    paper: t("types.paper"),
    recyclable: t("types.recyclable"),
    packaging: t("types.packaging"),
  };

  // Look ahead 14 days for waste collection events
  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    return {
      startDate: startOfDay(today).toISOString(),
      endDate: endOfDay(addDays(today, 14)).toISOString(),
    };
  }, []);

  const { data: events, isLoading } = useEvents(startDate, endDate);

  // Filter and transform waste collection events
  const wasteEvents = useMemo(() => {
    if (!events) return [];

    const results: {
      id: string;
      title: string;
      date: Date;
      wasteType: (typeof WASTE_TYPES)[0];
      daysUntil: number;
    }[] = [];

    const today = new Date();

    for (const event of events) {
      const wasteType = detectWasteType(event.title);
      if (!wasteType) continue;

      const date = new Date(event.start_at);
      const daysUntil = differenceInCalendarDays(date, today);

      // Only show future or today events
      if (daysUntil >= 0) {
        results.push({
          id: event.id,
          title: event.title,
          date,
          wasteType,
          daysUntil,
        });
      }
    }

    // Sort by date, deduplicate by waste type (keep earliest)
    results.sort((a, b) => a.date.getTime() - b.date.getTime());
    const seen = new Set<string>();
    const unique = results.filter((r) => {
      if (seen.has(r.wasteType.id)) return false;
      seen.add(r.wasteType.id);
      return true;
    });

    return unique.slice(0, maxItems);
  }, [events, maxItems]);

  if (isLoading) {
    return <WasteCollectionSkeleton />;
  }

  // Don't render if no waste collection events found
  if (wasteEvents.length === 0) {
    return null;
  }

  const formatDayLabel = (date: Date, daysUntil: number) => {
    if (isToday(date)) return t("today");
    if (isTomorrow(date)) return t("tomorrow");
    if (daysUntil <= 6) return format(date, "EEEE", { locale: dateLocale });
    return format(date, "EEE, d. MMM", { locale: dateLocale });
  };

  return (
    <TooltipProvider>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <Card className={`accent-border-top h-full ${className}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-xl font-medium">
                <span className="p-1.5 rounded-lg bg-month-primary/10">
                  <Recycle className="size-5 text-month-primary" strokeWidth={1.5} />
                </span>
                {t("title")}
              </CardTitle>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href="/calendar"
                    className="p-1 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("calendarTooltip")}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              {wasteEvents.map((event, index) => {
                const Icon = event.wasteType.icon;
                const isUrgent = event.daysUntil <= 1;

                return (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.08 }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors"
                    style={{
                      backgroundColor: event.daysUntil === 0 ? `${event.wasteType.color}20` : event.wasteType.bgColor,
                      borderLeft: isUrgent ? `3px solid ${event.wasteType.color}` : undefined,
                      ...(isUrgent ? { boxShadow: `inset 0 0 0 1px ${event.wasteType.color}40` } : {}),
                    }}
                    aria-label={t("itemAria", { label: wasteLabels[event.wasteType.id], when: formatDayLabel(event.date, event.daysUntil) })}
                  >
                    <div
                      className="p-2 rounded-lg shrink-0"
                      style={{ backgroundColor: `${event.wasteType.color}25` }}
                    >
                      <Icon
                        className="size-4"
                        style={{ color: event.wasteType.color }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {wasteLabels[event.wasteType.id]}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDayLabel(event.date, event.daysUntil)}
                        {event.date.getHours() > 0 && ` ${format(event.date, "HH:mm")}`}
                      </p>
                    </div>
                    {isUrgent && (
                      <Badge
                        variant="outline"
                        className={`shrink-0 text-[10px] px-1.5 border-0 ${event.daysUntil === 0 ? "animate-pulse" : ""}`}
                        style={{
                          backgroundColor: `${event.wasteType.color}30`,
                          color: event.wasteType.color,
                        }}
                      >
                        {event.daysUntil === 0 ? t("todayBadge") : t("tomorrowBadge")}
                      </Badge>
                    )}
                    {!isUrgent && (
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {t("daysSuffix", { count: event.daysUntil })}
                      </span>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </TooltipProvider>
  );
}
