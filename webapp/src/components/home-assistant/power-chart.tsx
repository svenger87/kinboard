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
  ReferenceLine,
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
  dashed?: boolean; // render as a dashed stroke with no fill (e.g. consumption over generation)
  // For calculated values: specify formula components
  calculated?: {
    type: "grid_import"; // Netzbezug = home_consumption - solar + battery
    homeConsumption: string; // entity_id for smart meter
    solar: string; // entity_id for solar power
    battery: string; // entity_id for battery power (positive = charge, negative = discharge)
  };
}

interface PowerChartProps {
  histories: EntityHistory[];
  lines: ChartLine[];
  height?: number;
  className?: string;
  period: "today" | "week" | "month" | "year";
  unitKw?: boolean; // If true, values are already in kW (don't divide by 1000)
  curveType?: "monotone" | "stepAfter" | "linear"; // Chart interpolation type
  aggregation?: "avg" | "max"; // How to aggregate values within intervals
}

// Format power values
const formatPower = (value: number, unitKw?: boolean): string => {
  if (unitKw) {
    return `${value.toFixed(1)} kW`;
  }
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)} kW`;
  }
  return `${Math.round(value)} W`;
};

export function PowerChart({
  histories,
  lines,
  height = 280,
  className,
  period,
  unitKw,
  curveType = "monotone",
  aggregation = "avg",
}: PowerChartProps) {
  const t = useTranslations("homeAutomation.charts");
  const locale = useLocale();
  const intlLocale = getIntlLocale(locale);

  // Process and aggregate data based on period
  const chartData = useMemo(() => {
    if (histories.length === 0 || lines.length === 0) return [];

    // Determine aggregation interval based on period
    const intervalMinutes: Record<string, number> = {
      today: 5,      // 5 minute intervals for today
      week: 30,      // 30 minute intervals for week
      month: 60,     // 1 hour intervals for month
      year: 360,     // 6 hour intervals for year
    };

    const interval = (intervalMinutes[period] || 5) * 60 * 1000;

    // Collect ALL entity IDs needed (direct lines + calculated components)
    const allEntityIds = new Set<string>();
    lines.forEach(line => {
      if (line.calculated) {
        // Add component entity IDs for calculated lines
        allEntityIds.add(line.calculated.homeConsumption);
        allEntityIds.add(line.calculated.solar);
        allEntityIds.add(line.calculated.battery);
      } else {
        allEntityIds.add(line.entityId);
      }
    });

    // First, sort each entity's history by timestamp and build a sorted list
    const entitySortedHistory = new Map<string, Array<{ timestamp: number; state: number }>>();

    histories.forEach((history) => {
      if (!allEntityIds.has(history.entity_id)) return;

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

    // Build chart data with forward-filled values
    // For each timestamp, use the latest known value for each entity
    const data: Array<Record<string, number>> = [];

    // Track current index for each entity for efficient lookup
    const entityIndices = new Map<string, number>();
    const allEntityIdsArray = Array.from(allEntityIds);
    allEntityIdsArray.forEach(id => entityIndices.set(id, 0));

    // Track last known value for each entity (for forward-fill)
    const lastKnownValues = new Map<string, number>();

    for (const timestamp of sortedTimestamps) {
      const result: Record<string, number> = { timestamp };
      const intervalEnd = timestamp + interval;

      // First, collect raw values for ALL entities (including calculated components)
      for (const entityId of allEntityIdsArray) {
        const sorted = entitySortedHistory.get(entityId);
        if (!sorted || sorted.length === 0) continue;

        let idx = entityIndices.get(entityId) || 0;
        const values: number[] = [];

        // Collect all values within this interval
        while (idx < sorted.length && sorted[idx].timestamp < intervalEnd) {
          if (sorted[idx].timestamp >= timestamp) {
            values.push(sorted[idx].state);
          }
          // Update last known value
          lastKnownValues.set(entityId, sorted[idx].state);
          idx++;
        }

        // Update index for next iteration
        entityIndices.set(entityId, idx > 0 ? idx - 1 : 0);

        if (values.length > 0) {
          // Aggregate values in this interval
          result[entityId] = aggregation === "max"
            ? Math.max(...values)
            : values.reduce((a, b) => a + b, 0) / values.length;
        } else {
          // Forward-fill: use last known value
          const lastValue = lastKnownValues.get(entityId);
          if (lastValue !== undefined) {
            result[entityId] = lastValue;
          }
        }
      }

      // Now compute calculated values for lines that have the `calculated` property
      for (const line of lines) {
        if (line.calculated?.type === "grid_import") {
          const homeConsumption = result[line.calculated.homeConsumption] ?? 0;
          const solar = result[line.calculated.solar] ?? 0;
          const battery = result[line.calculated.battery] ?? 0;
          // Netzbezug = homeConsumption - solar + battery
          // battery positive = charging (takes power, increases grid import)
          // battery negative = discharging (gives power, decreases grid import)
          const gridImport = homeConsumption - solar + battery;
          // Only show positive values (can't have negative grid import)
          result[line.entityId] = Math.max(0, gridImport);
        }
      }

      data.push(result);
    }

    return data;
  }, [histories, lines, period, aggregation]);

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
                  {formatPower(entry.value, unitKw)}
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
          margin={{ top: 5, right: 5, left: -15, bottom: 0 }}
        >
          <defs>
            {lines.map((line) => (
              <linearGradient
                key={line.entityId}
                id={`gradient-${line.entityId.replace(/\./g, "-")}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={line.color} stopOpacity={0.2} />
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
            tickFormatter={(v) => `${v}`}
            width={45}
            label={unitKw ? { value: "kW", position: "insideTopLeft", offset: -5, style: { fontSize: 11, fill: "currentColor", opacity: 0.6 } } : undefined}
          />

          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: "currentColor", strokeOpacity: 0.2 }}
          />

          <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.2} />

          {lines.map((line) => (
            <Area
              key={line.entityId}
              type={curveType}
              dataKey={line.entityId}
              stroke={line.color}
              strokeDasharray={line.dashed ? "5 4" : undefined}
              fill={line.dashed || line.showArea === false ? "transparent" : `url(#gradient-${line.entityId.replace(/\./g, "-")})`}
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
