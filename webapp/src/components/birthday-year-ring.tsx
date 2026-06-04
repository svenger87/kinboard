"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import { format, getDayOfYear, startOfDay } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";

interface BirthdayDot {
  id: string;
  name: string;
  date: Date;
  daysUntil: number;
  color: string;
}

interface BirthdayYearRingProps {
  birthdays: BirthdayDot[];
  size?: number;
}

function dayToAngle(dayOfYear: number, daysInYear: number) {
  return (dayOfYear / daysInYear) * 360 - 90;
}

function angleToXY(angleDeg: number, radius: number, center: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: center + radius * Math.cos(rad),
    y: center + radius * Math.sin(rad),
  };
}

export function BirthdayYearRing({ birthdays, size = 280 }: BirthdayYearRingProps) {
  const t = useTranslations("components.birthdayYearRing");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const center = size / 2;
  const ringRadius = size / 2 - 32;
  const labelRadius = size / 2 - 10;
  const dotRadius = 6;

  const monthLabels = useMemo(
    () => Array.from({ length: 12 }, (_, i) => format(new Date(2000, i, 1), "MMM", { locale: dateLocale })),
    [dateLocale]
  );

  const today = startOfDay(new Date());
  const todayDayOfYear = getDayOfYear(today);
  const currentYear = today.getFullYear();
  const isLeapYear = new Date(currentYear, 1, 29).getDate() === 29;
  const daysInYear = isLeapYear ? 366 : 365;
  const currentMonth = today.getMonth();

  const todayAngle = dayToAngle(todayDayOfYear, daysInYear);

  const monthTicks = useMemo(() => {
    return monthLabels.map((label, i) => {
      const monthStart = new Date(currentYear, i, 1);
      const doy = getDayOfYear(monthStart);
      const angle = dayToAngle(doy, daysInYear);
      const tickStart = angleToXY(angle, ringRadius - 8, center);
      const tickEnd = angleToXY(angle, ringRadius + 8, center);
      const labelPos = angleToXY(angle, labelRadius, center);
      return { label, angle, tickStart, tickEnd, labelPos };
    });
  }, [currentYear, daysInYear, ringRadius, labelRadius, center, monthLabels]);

  const dots = useMemo(() => {
    return birthdays.map((b) => {
      const doy = getDayOfYear(b.date);
      const angle = dayToAngle(doy, daysInYear);
      const pos = angleToXY(angle, ringRadius, center);
      return { ...b, angle, pos };
    });
  }, [birthdays, daysInYear, ringRadius, center]);

  return (
    <div className="flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        {/* Background ring */}
        <circle
          cx={center}
          cy={center}
          r={ringRadius}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="text-white/[0.06]"
        />

        {/* Month tick marks and labels */}
        {monthTicks.map((tick, i) => (
          <g key={`month-${i}`}>
            <line
              x1={tick.tickStart.x}
              y1={tick.tickStart.y}
              x2={tick.tickEnd.x}
              y2={tick.tickEnd.y}
              stroke="currentColor"
              strokeWidth={1}
              className={i === currentMonth ? "text-month-primary/60" : "text-white/20"}
            />
            <text
              x={tick.labelPos.x}
              y={tick.labelPos.y}
              textAnchor="middle"
              dominantBaseline="central"
              className={`text-[9px] font-medium ${
                i === currentMonth ? "fill-month-primary" : "fill-muted-foreground/60"
              }`}
            >
              {tick.label}
            </text>
          </g>
        ))}

        {/* Today marker */}
        <line
          x1={angleToXY(todayAngle, ringRadius - 12, center).x}
          y1={angleToXY(todayAngle, ringRadius - 12, center).y}
          x2={angleToXY(todayAngle, ringRadius + 12, center).x}
          y2={angleToXY(todayAngle, ringRadius + 12, center).y}
          stroke="hsl(var(--month-primary))"
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.8}
        />

        {/* Birthday dots */}
        {dots.map((dot, i) => (
          <motion.g
            key={dot.id}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3 + i * 0.05, type: "spring", stiffness: 200 }}
          >
            {/* Glow for nearby birthdays */}
            {dot.daysUntil <= 30 && (
              <circle
                cx={dot.pos.x}
                cy={dot.pos.y}
                r={dotRadius + 4}
                fill={dot.color}
                opacity={0.15}
              />
            )}
            {/* Dot */}
            <circle
              cx={dot.pos.x}
              cy={dot.pos.y}
              r={dot.daysUntil <= 7 ? dotRadius + 1 : dotRadius}
              fill={dot.color}
              stroke="hsl(var(--background))"
              strokeWidth={1.5}
              className="cursor-pointer"
            />
            {/* Name label for close birthdays */}
            {dot.daysUntil <= 30 && (
              <text
                x={dot.pos.x}
                y={dot.pos.y - dotRadius - 6}
                textAnchor="middle"
                className="fill-foreground/80 text-[8px] font-medium pointer-events-none"
              >
                {dot.name.split(" ")[0]}
              </text>
            )}
          </motion.g>
        ))}

        {/* Center text */}
        <text
          x={center}
          y={center - 8}
          textAnchor="middle"
          className="fill-foreground text-lg font-bold"
        >
          {birthdays.length}
        </text>
        <text
          x={center}
          y={center + 10}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          {t("centerLabel")}
        </text>
      </svg>
    </div>
  );
}
