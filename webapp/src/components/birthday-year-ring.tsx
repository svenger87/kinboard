"use client";

import { useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { format, getDayOfYear, startOfDay } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { personOn } from "@/lib/person-color";

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

  // One avatar per birthday overlapped into an unreadable smear at real
  // household volume — around fifty entries, six or more discs stack in the
  // dense months and only slivers remain (audit KB-60). The compact month strip
  // on this same page already solves density with "+N" counts; the ring now
  // uses the same convention.
  //
  // Two marks can sit side by side only if their centres are at least one
  // diameter apart along the circumference, which is a fixed angle for a given
  // ring radius — so the threshold is derived, not guessed.
  const dots = useMemo(() => {
    const placed = birthdays
      .map((b) => {
        const doy = getDayOfYear(b.date);
        return { ...b, angle: dayToAngle(doy, daysInYear) };
      })
      .sort((a, b) => a.angle - b.angle);

    const minSeparation =
      (2 * Math.asin(Math.min(1, (avatarRadius + 2) / ringRadius)) * 180) / Math.PI;

    // Compare against the cluster's FIRST member, not its most recent one.
    // Chaining off the last member merges everything: with ~52 birthdays,
    // consecutive angles differ by ~7deg, each is within the ~17deg threshold of
    // the one before it, and the whole year collapses into a single cluster.
    const clusters: (typeof placed)[] = [];
    for (const b of placed) {
      const current = clusters[clusters.length - 1];
      if (current && b.angle - current[0].angle < minSeparation) current.push(b);
      else clusters.push([b]);
    }

    // The ring is a circle, so the last cluster and the first are neighbours
    // even though their angles are ~359deg apart. Without this, a birthday on
    // 31 Dec and one on 1 Jan render on top of each other — the single
    // remaining overlap after clustering.
    if (clusters.length > 1) {
      const first = clusters[0];
      const last = clusters[clusters.length - 1];
      if (360 - last[0].angle + first[0].angle < minSeparation) {
        first.unshift(...last);
        clusters.pop();
      }
    }

    return clusters.map((group) => {
      // The next birthday is the one the page is about, so it always represents
      // its cluster visually rather than being hidden behind an earlier one.
      const lead = group.find((g) => g.id === nextId) ?? group[0];
      // ...but POSITION comes from the cluster's first member, not the lead.
      // Cluster boundaries are computed from group[0], so rendering at the
      // lead's angle lets a cluster drift forward into the following one when
      // the next birthday happens to sit late within it — which reintroduced
      // exactly one overlapping pair after the clustering was in place.
      const angle = group[0].angle;
      return { ...lead, angle, pos: angleToXY(angle, ringRadius, center), extra: group.length - 1 };
    });
  }, [birthdays, daysInYear, ringRadius, center, avatarRadius, nextId]);

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
                    fill={personOn(dot.color)}
                  >
                    {(dot.name.trim()[0] ?? "?").toUpperCase()}
                  </text>
                </>
              )}

              {/* "+N" for the birthdays this mark stands in for, so a dense
                  month reads as a count rather than a smear (audit KB-60). */}
              {dot.extra > 0 && (
                <g className="pointer-events-none">
                  <circle
                    cx={dot.pos.x + avatarRadius * 0.85}
                    cy={dot.pos.y - avatarRadius * 0.85}
                    r={9}
                    fill="hsl(var(--background))"
                    stroke="hsl(var(--border))"
                  />
                  <text
                    x={dot.pos.x + avatarRadius * 0.85}
                    y={dot.pos.y - avatarRadius * 0.85}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="text-3xs font-bold"
                    fill="hsl(var(--foreground))"
                  >
                    +{dot.extra}
                  </text>
                </g>
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
