"use client";

interface Props {
  cents: number;
  currency: string;
  todayInterestCents?: number;
  className?: string;
}

function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
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
