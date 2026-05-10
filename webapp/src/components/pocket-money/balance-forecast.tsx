"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { TrendingUp } from "lucide-react";
import { projectBalance } from "@/lib/pocket-money/interest";
import { formatCents } from "@/lib/pocket-money/format";

const MILESTONES: ReadonlyArray<{ days: number; labelKey: string }> = [
  { days: 30, labelKey: "horizonOneMonth" },
  { days: 90, labelKey: "horizonThreeMonths" },
  { days: 180, labelKey: "horizonSixMonths" },
  { days: 365, labelKey: "horizonOneYear" },
];

interface Props {
  balanceCents: number;
  pendingInterestCents: number;
  maxBalanceEligibleCents: number;
  aprBps: number;
  weeklyAllowanceCents: number;
  allowanceIntervalDays: number;
  currency: string;
}

export function BalanceForecast({
  balanceCents,
  pendingInterestCents,
  maxBalanceEligibleCents,
  aprBps,
  weeklyAllowanceCents,
  allowanceIntervalDays,
  currency,
}: Props) {
  const t = useTranslations("settings.pocketMoney");

  const snapshots = useMemo(
    () =>
      projectBalance({
        balanceCents,
        pendingInterestCents,
        maxBalanceEligibleCents,
        aprBps,
        weeklyAllowanceCents,
        allowanceIntervalDays,
        horizonDays: 365,
        milestoneDays: MILESTONES.map((m) => m.days),
      }),
    [
      balanceCents,
      pendingInterestCents,
      maxBalanceEligibleCents,
      aprBps,
      weeklyAllowanceCents,
      allowanceIntervalDays,
    ],
  );

  // Reflect the eligibility-cap reality: if the projection has been
  // running against the cap for a while, callers should know.
  const hitCap = snapshots.some(
    (s) => s.balanceCents >= maxBalanceEligibleCents,
  );

  return (
    <div className="rounded-lg border border-border bg-white/[0.02] p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <TrendingUp className="size-3.5" />
        <span>{t("forecastTitle")}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {MILESTONES.map((m) => {
          const snap = snapshots.find((s) => s.day === m.days);
          return (
            <div
              key={m.days}
              className="rounded-md bg-white/[0.03] px-2 py-1.5 text-center"
            >
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t(m.labelKey)}
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {snap ? formatCents(snap.balanceCents, currency) : "—"}
              </p>
            </div>
          );
        })}
      </div>
      {hitCap && (
        <p className="text-[11px] text-amber-500">
          {t("forecastCapHint", {
            cap: formatCents(maxBalanceEligibleCents, currency),
          })}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">
        {t("forecastDisclaimer")}
      </p>
    </div>
  );
}
