"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { getIntlLocale } from "@/i18n/intl-locale";
import { cn } from "@/lib/utils";

interface StatisticsCardProps {
  title: string;
  value: number | string;
  unit?: string;
  previousValue?: number;
  icon?: React.ReactNode;
  color?: "default" | "solar" | "battery" | "grid" | "home" | "success" | "warning" | "danger";
  className?: string;
  showTrend?: boolean;
  format?: "number" | "currency" | "percentage";
  decimals?: number;
}

const COLOR_STYLES: Record<string, { bg: string; text: string; icon: string }> = {
  default: { bg: "bg-muted/50", text: "text-foreground", icon: "text-muted-foreground" },
  solar: { bg: "bg-energy-solar/10", text: "text-energy-solar", icon: "text-energy-solar" },
  battery: { bg: "bg-energy-battery/10", text: "text-energy-battery", icon: "text-energy-battery" },
  grid: { bg: "bg-energy-grid/10", text: "text-energy-grid", icon: "text-energy-grid" },
  home: { bg: "bg-energy-consumption/10", text: "text-energy-consumption", icon: "text-energy-consumption" },
  success: { bg: "bg-success/10", text: "text-success", icon: "text-success" },
  warning: { bg: "bg-warning/10", text: "text-warning", icon: "text-warning" },
  danger: { bg: "bg-destructive/10", text: "text-destructive", icon: "text-destructive" },
};

export function StatisticsCard({
  title,
  value,
  unit,
  previousValue,
  icon,
  color = "default",
  className,
  showTrend = true,
  format = "number",
  decimals = 1,
}: StatisticsCardProps) {
  const t = useTranslations("homeAutomation.charts");
  const locale = useLocale();
  const intlLocale = getIntlLocale(locale);
  const styles = COLOR_STYLES[color];

  // Format the value
  const formatValue = (val: number | string): string => {
    if (typeof val === "string") return val;

    switch (format) {
      case "currency":
        return val.toLocaleString(intlLocale, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      case "percentage":
        return `${val.toFixed(decimals)}%`;
      default:
        return val.toLocaleString(intlLocale, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
    }
  };

  // Calculate trend
  const getTrend = () => {
    if (typeof value !== "number" || previousValue === undefined) return null;
    const diff = value - previousValue;
    const percentage = previousValue !== 0 ? (diff / previousValue) * 100 : 0;
    return { diff, percentage };
  };

  const trend = showTrend ? getTrend() : null;

  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-all bg-card hover:border-energy-solar/30",
        className
      )}
    >
      {/* Header with icon */}
      <div className="flex items-center gap-2 mb-3">
        {icon && (
          <div className={cn("p-1.5 rounded-lg", styles.bg, styles.icon)}>
            {icon}
          </div>
        )}
        <span className="text-sm text-muted-foreground">{title}</span>
      </div>

      {/* Value */}
      <div className="flex items-end gap-2">
        <span className={cn("text-2xl font-semibold", styles.text)}>
          {formatValue(value)}
        </span>
        {unit && <span className="text-sm text-muted-foreground mb-0.5">{unit}</span>}
      </div>

      {/* Trend indicator */}
      {trend && (
        <div className="flex items-center gap-1 mt-2">
          {trend.diff > 0 ? (
            <TrendingUp className="size-4 text-success" />
          ) : trend.diff < 0 ? (
            <TrendingDown className="size-4 text-destructive" />
          ) : (
            <Minus className="size-4 text-muted-foreground" />
          )}
          <span
            className={cn(
              "text-xs",
              trend.diff > 0
                ? "text-success"
                : trend.diff < 0
                ? "text-destructive"
                : "text-muted-foreground"
            )}
          >
            {trend.diff > 0 ? "+" : ""}
            {trend.percentage.toFixed(1)}%
          </span>
          <span className="text-xs text-muted-foreground">{t("trendComparison")}</span>
        </div>
      )}
    </div>
  );
}

// Grid of statistics cards
interface StatisticsGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

export function StatisticsGrid({ children, columns = 4, className }: StatisticsGridProps) {
  const gridCols = {
    2: "grid-cols-2",
    3: "grid-cols-2 md:grid-cols-3",
    4: "grid-cols-2 md:grid-cols-4",
  };

  return (
    <div className={cn("grid gap-4", gridCols[columns], className)}>
      {children}
    </div>
  );
}
