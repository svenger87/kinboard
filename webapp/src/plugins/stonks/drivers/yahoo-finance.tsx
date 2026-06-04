"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { TrendingUp, TrendingDown, Minus, LineChart } from "lucide-react";
import type { Ticker } from "@/types/database";
import type { Timeframe } from "@/lib/stonks/types";
import { useQuotes, useChart } from "@/hooks/use-stonks";
import { GlassCard } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StonksDriver } from "./types";

// lightweight-charts is sizable; load the candle chart on demand so it's not
// in the initial bundle for users who never open a ticker.
const CandleChart = dynamic(
  () => import("@/components/stonks/candle-chart").then((m) => m.CandleChart),
  { ssr: false }
);

const TIMEFRAMES: Timeframe[] = ["1d", "1w", "1m", "3m", "1y", "max"];

function formatPrice(n: number, currency: string | null): string {
  const normalized = currency?.toUpperCase() ?? null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: normalized ? "currency" : "decimal",
      currency: normalized ?? undefined,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    // Yahoo sometimes returns non-ISO codes (e.g. "GBp" for LSE pence).
    // Fall back to decimal + the raw code so the user still sees a price.
    return `${n.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

function formatPercent(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function changeColor(delta: number): string {
  if (delta > 0) return "text-success";
  if (delta < 0) return "text-destructive";
  return "text-muted-foreground";
}

function ChangeIcon({ delta, className }: { delta: number; className?: string }) {
  if (delta > 0) return <TrendingUp className={className} />;
  if (delta < 0) return <TrendingDown className={className} />;
  return <Minus className={className} />;
}

function YahooFinanceCard({ ticker }: { ticker: Ticker }) {
  const t = useTranslations("stonks.drivers.yahoo-finance");
  const tCommon = useTranslations("stonks");
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const { data: quotes = [], isPending: quotesLoading } = useQuotes([ticker.symbol]);
  const { data: candles = [], isPending: chartLoading } = useChart(ticker.symbol, timeframe);

  const quote = quotes[0];

  return (
    <div className="space-y-6">
      <GlassCard className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{quote?.shortName ?? ticker.symbol}</p>
            <h2 className="text-3xl font-bold flex items-baseline gap-2">
              <span>{ticker.nickname ?? ticker.symbol}</span>
              {quote?.exchange && (
                <Badge variant="outline" className="text-xs">{quote.exchange}</Badge>
              )}
            </h2>
          </div>
          {quote?.marketState && (
            <Badge
              variant="outline"
              className={
                quote.marketState === "REGULAR"
                  ? "border-success/50 text-success"
                  : "text-muted-foreground"
              }
            >
              {tCommon(`marketState.${quote.marketState.toLowerCase()}` as never)}
            </Badge>
          )}
        </div>

        {quotesLoading ? (
          <Skeleton className="h-12 w-48 mt-4" />
        ) : quote ? (
          <div className="mt-4 flex items-baseline gap-3">
            <p className="text-4xl font-bold">{formatPrice(quote.price, quote.currency)}</p>
            <div className={`flex items-center gap-1 ${changeColor(quote.change)}`}>
              <ChangeIcon delta={quote.change} className="size-5" />
              <span className="text-lg font-semibold">{formatPrice(quote.change, quote.currency)}</span>
              <span className="text-base">({formatPercent(quote.changePercent)})</span>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">{t("quoteUnavailable")}</p>
        )}
      </GlassCard>

      <GlassCard className="p-4">
        <Tabs value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)} className="mb-4">
          <TabsList>
            {TIMEFRAMES.map((tf) => (
              <TabsTrigger key={tf} value={tf}>
                {tCommon(`timeframe.${tf}` as never)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {chartLoading ? (
          <Skeleton className="h-[400px] w-full" />
        ) : candles.length > 0 ? (
          <CandleChart candles={candles} height={400} />
        ) : (
          <div className="h-[400px] flex items-center justify-center text-muted-foreground">
            {t("chartUnavailable")}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function YahooFinanceWidgetCard({ ticker }: { ticker: Ticker }) {
  const t = useTranslations("stonks.drivers.yahoo-finance");
  const { data: quotes = [], isPending } = useQuotes([ticker.symbol]);
  const quote = quotes[0];

  if (isPending) {
    return (
      <GlassCard className="p-4">
        <Skeleton className="h-4 w-24 mb-2" />
        <Skeleton className="h-8 w-32" />
      </GlassCard>
    );
  }

  if (!quote) {
    return (
      <GlassCard className="p-4">
        <p className="text-sm text-muted-foreground">{ticker.symbol}</p>
        <p className="text-xs text-muted-foreground">{t("quoteUnavailable")}</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-4 space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{ticker.nickname ?? ticker.symbol}</p>
        <ChangeIcon delta={quote.change} className={`size-4 ${changeColor(quote.change)}`} />
      </div>
      <p className="text-2xl font-bold">{formatPrice(quote.price, quote.currency)}</p>
      <p className={`text-sm ${changeColor(quote.change)}`}>{formatPercent(quote.changePercent)}</p>
    </GlassCard>
  );
}

function YahooFinanceConfigForm({
  ticker,
  onChange,
}: {
  ticker: Ticker;
  onChange: (patch: { nickname?: string | null; color?: string | null }) => void;
}) {
  const t = useTranslations("settings.stonks");
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`${ticker.id}-nickname`}>{t("nicknameLabel")}</Label>
        <Input
          id={`${ticker.id}-nickname`}
          defaultValue={ticker.nickname ?? ""}
          placeholder={ticker.symbol}
          onBlur={(e) => onChange({ nickname: e.target.value.trim() || null })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${ticker.id}-color`}>{t("colorLabel")}</Label>
        <Input
          id={`${ticker.id}-color`}
          type="color"
          defaultValue={ticker.color ?? "#22c55e"}
          onBlur={(e) => onChange({ color: e.target.value })}
          className="w-16 h-8 p-1"
        />
      </div>
    </div>
  );
}

export const yahooFinanceDriver: StonksDriver = {
  id: "yahoo-finance",
  displayNameKey: "yahoo-finance",
  icon: LineChart,
  Card: YahooFinanceCard,
  WidgetCard: YahooFinanceWidgetCard,
  ConfigForm: YahooFinanceConfigForm,
};
