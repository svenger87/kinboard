"use client";

import { formatCents } from "@/lib/pocket-money/format";

interface Props {
  cents: number;
  currency: string;
  todayInterestCents?: number;
  className?: string;
}

export function BalanceDisplay({ cents, currency, todayInterestCents = 0, className = "" }: Props) {
  return (
    <div className={`flex items-baseline gap-3 ${className}`}>
      <p className="text-5xl font-bold">{formatCents(cents, currency)}</p>
      {todayInterestCents > 0 && (
        <p className="text-base font-semibold text-success">
          + {formatCents(todayInterestCents, currency)} today
        </p>
      )}
    </div>
  );
}
