"use client";

import { useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { format, getDayOfYear, startOfDay } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";

interface BirthdayDot {
  id: string;
  name: string;
  date: Date;
  daysUntil: number;
  color: string;
  avatarUrl?: string | null;
}

interface BirthdayYearRingProps {
  birthdays: BirthdayDot[];
  size?: number;
  /** Next-birthday person name for the center label. */
  nextName?: string;
  /** Age the next person turns (omit if year unknown). */
  nextAge?: number;
  /** Whole days until the next birthday. */
  nextDaysUntil?: number;
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

export function BirthdayYearRing({
  birthdays,
  size = 360,
  nextName,
  nextAge,
  nextDaysUntil,
}: BirthdayYearRingProps) {
  const t = useTranslations("components.birthdayYearRing");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const center = size / 2;
  const ringRadius = size / 2 - 40;
  const labelRadius = size / 2 - 14;
  const avatarRadius = 13;
  // The next birthday = the smallest daysUntil among the supplied dots.
  const nextId = useMemo(() => {
    if (birthdays.length === 0) return null;
    return birthdays.reduce((min, b) => (b.daysUntil < min.daysUntil ? b : min), birthdays[0]).id;
  }, [birthdays]);

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
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-auto overflow-visible">
        {/* Background ring */}
        <circle
          cx={center}
          cy={center}
          r={ringRadius}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="text-border"
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
              className={i === currentMonth ? "text-primary/60" : "text-foreground/15"}
            />
            <text
              x={tick.labelPos.x}
              y={tick.labelPos.y}
              textAnchor="middle"
              dominantBaseline="central"
              className={`text-3xs font-medium ${
                i === currentMonth ? "fill-primary" : "fill-muted-foreground/60"
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
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.8}
        />

        {/* Birthday avatar marks */}
        {dots.map((dot) => {
          const isNext = dot.id === nextId;
          const hasImage =
            !!dot.avatarUrl &&
            (dot.avatarUrl.startsWith("http") || dot.avatarUrl.startsWith("data:"));
          const clipId = `bday-clip-${dot.id}`;
          return (
            <g key={dot.id} className="cursor-pointer">
              {/* Next-birthday highlight ring */}
              {isNext && (
                <circle
                  cx={dot.pos.x}
                  cy={dot.pos.y}
                  r={avatarRadius + 4}
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.5}
                  opacity={0.9}
                />
              )}
              {/* Background contrast circle */}
              <circle
                cx={dot.pos.x}
                cy={dot.pos.y}
                r={avatarRadius + 1.5}
                fill="hsl(var(--background))"
              />
              {hasImage ? (
                <>
                  <clipPath id={clipId}>
                    <circle cx={dot.pos.x} cy={dot.pos.y} r={avatarRadius} />
                  </clipPath>
                  <image
                    href={dot.avatarUrl as string}
                    x={dot.pos.x - avatarRadius}
                    y={dot.pos.y - avatarRadius}
                    width={avatarRadius * 2}
                    height={avatarRadius * 2}
                    clipPath={`url(#${clipId})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                </>
              ) : (
                <>
                  <circle cx={dot.pos.x} cy={dot.pos.y} r={avatarRadius} fill={dot.color} />
                  <text
                    x={dot.pos.x}
                    y={dot.pos.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="text-2xs font-bold pointer-events-none"
                    fill="#ffffff"
                  >
                    {(dot.name.trim()[0] ?? "?").toUpperCase()}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* Center text — next birthday, or fallback to count */}
        {nextName ? (
          <>
            <text
              x={center}
              y={center - 14}
              textAnchor="middle"
              className="fill-foreground text-lg font-display font-medium"
            >
              {nextName}
            </text>
            {typeof nextAge === "number" && (
              <text
                x={center}
                y={center + 6}
                textAnchor="middle"
                className="fill-primary text-2xs font-medium"
              >
                {t("centerTurns", { age: nextAge })}
              </text>
            )}
            <text
              x={center}
              y={center + 24}
              textAnchor="middle"
              className="fill-muted-foreground text-3xs tabular-nums"
            >
              {t("centerInDays", { count: nextDaysUntil ?? 0 })}
            </text>
          </>
        ) : (
          <>
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
              className="fill-muted-foreground text-3xs"
            >
              {t("centerLabel")}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
