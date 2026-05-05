"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import type { EntityHistory } from "@/types/home-assistant";

interface BatteryChartProps {
  history: EntityHistory | undefined;
  height?: number;
  className?: string;
  period: "today" | "week" | "month" | "year";
}

export function BatteryChart({
  history,
  height = 120,
  className,
  period,
}: BatteryChartProps) {
  const t = useTranslations("homeAutomation.charts");
  const locale = useLocale();
  const intlLocale = locale === "de" ? "de-DE" : "en-US";

  // Process data
  const chartData = useMemo(() => {
    if (!history || history.history.length === 0) return [];

    // Aggregate based on period
    const intervalMinutes: Record<string, number> = {
      today: 10,
      week: 60,
      month: 120,
      year: 720,
    };

    const interval = (intervalMinutes[period] || 10) * 60 * 1000;
    const dataMap = new Map<number, number[]>();

    history.history.forEach((point) => {
      const timestamp = new Date(point.timestamp).getTime();
      const rounded = Math.floor(timestamp / interval) * interval;
      if (!dataMap.has(rounded)) {
        dataMap.set(rounded, []);
      }
      dataMap.get(rounded)!.push(point.state);
    });

    return Array.from(dataMap.entries())
      .map(([timestamp, values]) => ({
        timestamp,
        soc: values.reduce((a, b) => a + b, 0) / values.length,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [history, period]);

  // Format X-axis
  const formatXAxis = (timestamp: number) => {
    const date = new Date(timestamp);
    if (period === "today") {
      return date.toLocaleTimeString(intlLocale, { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString(intlLocale, { weekday: "short", day: "2-digit" });
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: {
    active?: boolean;
    payload?: Array<{ value: number }>;
    label?: number;
  }) => {
    if (!active || !payload?.[0] || !label) return null;
    const date = new Date(label);
    const timeStr = period === "today"
      ? date.toLocaleTimeString(intlLocale, { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString(intlLocale, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

    return (
      <div className="bg-popover/95 backdrop-blur border rounded-lg px-3 py-2 shadow-xl">
        <p className="text-xs text-muted-foreground">{timeStr}</p>
        <p className="text-sm font-medium">{Math.round(payload[0].value)}%</p>
      </div>
    );
  };

  if (chartData.length === 0) {
    return (
      <div className={cn("flex items-center justify-center text-muted-foreground text-sm", className)} style={{ height }}>
        {t("noData")}
      </div>
    );
  }

  // Determine color based on current SoC
  const currentSoc = chartData[chartData.length - 1]?.soc || 0;
  const color = currentSoc > 50 ? "#22c55e" : currentSoc > 20 ? "#eab308" : "#ef4444";

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="socGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="timestamp"
            tickFormatter={formatXAxis}
            tick={{ fontSize: 12, fill: "currentColor", opacity: 0.6 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={80}
          />

          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 12, fill: "currentColor", opacity: 0.6 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
            width={35}
          />

          <Tooltip content={<CustomTooltip />} />

          <ReferenceLine y={20} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
          <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.5} />

          <Area
            type="monotone"
            dataKey="soc"
            stroke={color}
            fill="url(#socGradient)"
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
