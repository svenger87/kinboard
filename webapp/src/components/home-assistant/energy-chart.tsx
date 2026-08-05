"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTranslations, useLocale } from "next-intl";
import { getIntlLocale } from "@/i18n/intl-locale";
import { cn } from "@/lib/utils";
import type { EntityHistory } from "@/types/home-assistant";

// Chart line configuration
interface ChartLine {
  entityId: string;
  label: string;
  color: string;
  showArea?: boolean;
  dashed?: boolean; // render as a dashed stroke with no fill
}

interface EnergyChartProps {
  histories: EntityHistory[];
  lines: ChartLine[];
  height?: number;
  className?: string;
  period: "today" | "week" | "month" | "year";
}

// Format energy values (delta values are typically small, like 0.1-2 kWh per interval)
const formatEnergy = (value: number): string => {
  if (Math.abs(value) >= 100) {
    return `${value.toFixed(0)} kWh`;
  }
  if (Math.abs(value) >= 10) {
    return `${value.toFixed(1)} kWh`;
  }
  return `${value.toFixed(2)} kWh`;
};

export function EnergyChart({
  histories,
  lines,
  height = 280,
  className,
  period,
}: EnergyChartProps) {
  const t = useTranslations("homeAutomation.charts");
  const locale = useLocale();
  const intlLocale = getIntlLocale(locale);

  // Process and aggregate data based on period - normalize cumulative energy sensors to show change from start
  const chartData = useMemo(() => {
    if (histories.length === 0 || lines.length === 0) return [];

    // Determine aggregation interval based on period
    const intervalMinutes: Record<string, number> = {
      today: 15,     // 15 minute intervals for today
      week: 60,      // 1 hour intervals for week
      month: 180,    // 3 hour intervals for month
      year: 720,     // 12 hour intervals for year
    };

    const interval = (intervalMinutes[period] || 15) * 60 * 1000;

    // Only process entities that are in our lines config
    const lineEntityIds = new Set(lines.map(l => l.entityId));

    // First, sort each entity's history by timestamp
    const entitySortedHistory = new Map<string, Array<{ timestamp: number; state: number }>>();

    histories.forEach((history) => {
      if (!lineEntityIds.has(history.entity_id)) return;

      const sorted = history.history
        .map(point => ({
          timestamp: new Date(point.timestamp).getTime(),
          state: point.state
        }))
        .sort((a, b) => a.timestamp - b.timestamp);

      entitySortedHistory.set(history.entity_id, sorted);
    });

    // Collect all unique rounded timestamps from all entities
    const allTimestamps = new Set<number>();
    entitySortedHistory.forEach((sorted) => {
      sorted.forEach(point => {
        allTimestamps.add(Math.floor(point.timestamp / interval) * interval);
      });
    });

    // Sort timestamps
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

    if (sortedTimestamps.length === 0) return [];

    // Find the baseline (first) value for each entity
    const baselineValues: Record<string, number> = {};
    const lineEntityIdsArray = Array.from(lineEntityIds);
    for (const entityId of lineEntityIdsArray) {
      const sorted = entitySortedHistory.get(entityId);
      if (sorted && sorted.length > 0) {
        baselineValues[entityId] = sorted[0].state;
      }
    }

    // Build chart data with forward-filled values
    const data: Array<Record<string, number>> = [];

    // Track current index for each entity for efficient lookup
    const entityIndices = new Map<string, number>();
    lineEntityIdsArray.forEach(id => entityIndices.set(id, 0));

    // Track last known value for each entity (for forward-fill)
    const lastKnownValues = new Map<string, number>();

    for (const timestamp of sortedTimestamps) {
      const result: Record<string, number> = { timestamp };
      const intervalEnd = timestamp + interval;

      for (const entityId of lineEntityIdsArray) {
        const sorted = entitySortedHistory.get(entityId);
        if (!sorted || sorted.length === 0) continue;

        let idx = entityIndices.get(entityId) || 0;
        let latestValue: number | undefined;

        // Find the latest value within or before this interval
        while (idx < sorted.length && sorted[idx].timestamp < intervalEnd) {
          latestValue = sorted[idx].state;
          lastKnownValues.set(entityId, latestValue);
          idx++;
        }

        // Update index for next iteration (stay at current position for forward-fill)
        entityIndices.set(entityId, idx > 0 ? idx - 1 : 0);

        // Use latest value from this interval, or forward-fill from last known
        const valueToUse = latestValue !== undefined ? latestValue : lastKnownValues.get(entityId);
        const baseline = baselineValues[entityId];

        if (valueToUse !== undefined && baseline !== undefined) {
          // Show change from baseline (start of period)
          const change = valueToUse - baseline;
          // Only include non-negative changes
          result[entityId] = change >= 0 ? change : 0;
        }
      }

      data.push(result);
    }

    return data;
  }, [histories, lines, period]);

  // Format X-axis based on period
  const formatXAxis = (timestamp: number) => {
    const date = new Date(timestamp);

    if (period === "year" || period === "month") {
      return date.toLocaleDateString(intlLocale, {
        day: "2-digit",
        month: "2-digit",
      });
    }
    if (period === "week") {
      return date.toLocaleDateString(intlLocale, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return date.toLocaleTimeString(intlLocale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Format tooltip time
  const formatTooltipTime = (timestamp: number) => {
    const date = new Date(timestamp);
    if (period === "today") {
      return date.toLocaleTimeString(intlLocale, {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return date.toLocaleDateString(intlLocale, {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: {
    active?: boolean;
    payload?: Array<{ dataKey: string; value: number; color: string }>;
    label?: number;
  }) => {
    if (!active || !payload || !label) return null;

    // Find line config for each payload item
    const getLineConfig = (entityId: string) =>
      lines.find(l => l.entityId === entityId);

    return (
      <div className="bg-popover border rounded-lg p-3 elev-md">
        <p className="text-xs font-medium text-muted-foreground mb-2">
          {formatTooltipTime(label)}
        </p>
        <div className="flex flex-col gap-1.5">
          {payload.map((entry, index) => {
            const config = getLineConfig(entry.dataKey);
            if (!config) return null;
            return (
              <div key={index} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <div
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-sm">{config.label}</span>
                </div>
                <span className="text-sm font-medium tabular-nums">
                  {formatEnergy(entry.value)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Calculate tick count based on data
  const getTickInterval = () => {
    const len = chartData.length;
    if (len <= 8) return 0;
    if (period === "today") return Math.ceil(len / 8);
    if (period === "week") return Math.ceil(len / 7);
    return Math.ceil(len / 10);
  };

  /**
   * Width the y-axis needs for its widest label.
   *
   * Recharts draws ticks into the width it is given and clips the overflow
   * rather than making room, so a fixed value silently truncates once the
   * numbers grow — the sibling power chart lost the leading digit of every
   * four-digit reading that way. Labels here carry one decimal, so a whole
   * month's kWh total is the case that has to fit.
   */
  const yAxisWidth = useMemo(() => {
    let widest = 0;
    for (const point of chartData) {
      for (const [key, value] of Object.entries(point)) {
        if (key === "timestamp") continue;
        if (typeof value === "number" && Number.isFinite(value)) {
          widest = Math.max(widest, Math.abs(value));
        }
      }
    }
    // Integer digits, the decimal point and one decimal place, plus a little
    // slack because recharts rounds its ticks outward past the data.
    const chars = Math.round(widest).toString().length + 3;
    return Math.max(50, chars * 9 + 12);
  }, [chartData]);

  if (chartData.length === 0) {
    return (
      <div className={cn(
        "flex items-center justify-center text-muted-foreground text-sm",
        className
      )} style={{ height }}>
        {t("noDataLong")}
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 px-1">
        {lines.map((line) => (
          <div key={line.entityId} className="flex items-center gap-1.5">
            <div
              className="size-2.5 rounded-full"
              style={{ backgroundColor: line.color }}
            />
            <span className="text-xs text-muted-foreground">{line.label}</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={chartData}
          margin={{ top: 5, right: 5, left: -10, bottom: 0 }}
        >
          <defs>
            {lines.map((line) => (
              <linearGradient
                key={line.entityId}
                id={`energy-gradient-${line.entityId.replace(/\./g, "-")}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={line.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={line.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="currentColor"
            opacity={0.1}
          />

          <XAxis
            dataKey="timestamp"
            tickFormatter={formatXAxis}
            tick={{ fontSize: 12, fill: "currentColor", opacity: 0.7 }}
            axisLine={{ stroke: "currentColor", opacity: 0.1 }}
            tickLine={false}
            interval={getTickInterval()}
            minTickGap={50}
          />

          <YAxis
            tick={{ fontSize: 12, fill: "currentColor", opacity: 0.7 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v.toFixed(1)}`}
            width={yAxisWidth}
          />

          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: "currentColor", strokeOpacity: 0.2 }}
          />

          {lines.map((line) => (
            <Area
              key={line.entityId}
              type="monotone"
              dataKey={line.entityId}
              stroke={line.color}
              strokeDasharray={line.dashed ? "5 4" : undefined}
              fill={line.dashed || line.showArea === false ? "transparent" : `url(#energy-gradient-${line.entityId.replace(/\./g, "-")})`}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
