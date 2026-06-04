"use client";

import { useMemo } from "react";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import { useLocale } from "next-intl";
import { getIntlLocale } from "@/i18n/intl-locale";
import { cn } from "@/lib/utils";
import type { EntityHistory } from "@/types/home-assistant";

interface MiniChartProps {
  history: EntityHistory | null | undefined;
  color?: string;
  unit?: string;
  showTooltip?: boolean;
  className?: string;
  height?: number;
}

export function MiniChart({
  history,
  color = "#3B82F6",
  unit = "",
  showTooltip = true,
  className,
  height = 40,
}: MiniChartProps) {
  const locale = useLocale();
  const intlLocale = getIntlLocale(locale);

  // Transform history data for chart
  const chartData = useMemo(() => {
    if (!history?.history?.length) return [];

    return history.history.map((point) => ({
      timestamp: new Date(point.timestamp).getTime(),
      value: point.state,
    }));
  }, [history]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: {
    active?: boolean;
    payload?: Array<{ payload: { timestamp: number; value: number | string } }>;
  }) => {
    if (!active || !payload || payload.length === 0) return null;

    const data = payload[0].payload;
    const time = new Date(data.timestamp).toLocaleTimeString(intlLocale, {
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <div className="bg-popover border rounded px-2 py-1 text-xs shadow">
        <span className="text-muted-foreground">{time}:</span>{" "}
        <span className="font-medium">
          {typeof data.value === "number" ? data.value.toFixed(1) : data.value}
          {unit && ` ${unit}`}
        </span>
      </div>
    );
  };

  if (chartData.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center text-xs text-muted-foreground",
          className
        )}
        style={{ height }}
      >
        -
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`miniGradient-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {showTooltip && <Tooltip content={<CustomTooltip />} />}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            fill={`url(#miniGradient-${color.replace("#", "")})`}
            strokeWidth={1.5}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Sparkline variant - even simpler, no tooltip
export function Sparkline({
  values,
  color = "#3B82F6",
  className,
  height = 24,
}: {
  values: number[];
  color?: string;
  className?: string;
  height?: number;
}) {
  const chartData = useMemo(() => {
    return values.map((value, index) => ({ index, value }));
  }, [values]);

  if (chartData.length < 2) {
    return null;
  }

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`sparkGradient-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.2} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            fill={`url(#sparkGradient-${color.replace("#", "")})`}
            strokeWidth={1}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
