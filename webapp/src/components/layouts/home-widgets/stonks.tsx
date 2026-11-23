"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LineChart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTickers } from "@/hooks/use-tickers";
import { useQuotes } from "@/hooks/use-stonks";
import { useIsPluginEnabled } from "@/hooks/use-enabled-plugins";
import { ChangeIcon, changeColor, formatPercent, formatPrice } from "@/plugins/stonks/drivers/yahoo-finance";
import type { HomeWidgetProps } from "./shared";
import { BoxCard, SetUpBox, useShrinkStep } from "./rest-shared";

/** As the card: one ticker at a time, the next every eight seconds. */
const ROTATE_INTERVAL_MS = 8000;

/** Richest first: name, price and change; the price and change on one line; the price alone. */
const STEPS = ["full", "row", "price"] as const;

/**
 * The stonks card in a box (RFC-022 §3.1, fixed): a ticker's name, its
 * price large and the day's change, each ticker in turn as on the card,
 * from the same quote query per symbol. The whole box opens /stonks.
 */
export function StonksHomeWidget({ box }: HomeWidgetProps) {
  const t = useTranslations("dashboard.pluginDiscover");
  const tYahoo = useTranslations("stonks.drivers.yahoo-finance");
  const enabled = useIsPluginEnabled("stonks");
  const { data: tickers = [] } = useTickers();
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (tickers.length <= 1) return;
    const id = setInterval(() => setActiveIdx((i) => (i + 1) % tickers.length), ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tickers.length]);

  const tk = tickers[activeIdx >= tickers.length ? 0 : activeIdx];
  // The card's query, one symbol at a time, so both share it.
  const { data: quotes = [], isPending } = useQuotes(tk ? [tk.symbol] : []);
  const quote = tk ? quotes[0] : undefined;

  const ref = useRef<HTMLDivElement>(null);
  const step = useShrinkStep(ref, STEPS.length, [box.width, box.height, tk?.id, quote?.price, quote?.changePercent, isPending]);
  const s = STEPS[step];

  if (!enabled) {
    return <SetUpBox box={box} icon={LineChart} title={t("stonksName")} description={t("stonksDisabled")} href="/settings/plugins" testId="home-stonks" />;
  }
  if (!tk) {
    return <SetUpBox box={box} icon={LineChart} title={t("stonksName")} description={t("stonksEmpty")} href="/stonks" testId="home-stonks" />;
  }

  const name = tk.nickname ?? tk.symbol;
  return (
    <Link href="/stonks" className="block size-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" data-testid="home-stonks">
      <BoxCard box={box} ref={ref} step={step} className={`justify-center ${isPending ? "animate-pulse" : ""}`}>
        {!quote ? (
          <div className="min-w-0">
            <p className="truncate text-[0.85em] font-medium">{name}</p>
            {!isPending && <p className="text-[0.7em] text-muted-foreground">{tYahoo("quoteUnavailable")}</p>}
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-[0.15em]">
            {s === "full" && (
              <div className="flex items-center justify-between gap-[0.4em]">
                <p className="min-w-0 truncate text-[0.8em] font-medium">{name}</p>
                <ChangeIcon delta={quote.change} className={`size-[1em] shrink-0 ${changeColor(quote.change)}`} />
              </div>
            )}
            <div className={`flex ${s === "full" ? "flex-col" : "items-baseline gap-[0.5em]"}`}>
              <p className="whitespace-nowrap text-[1.5em] font-bold leading-tight tabular-nums">{formatPrice(quote.price, quote.currency)}</p>
              {s !== "price" && (
                <p className={`whitespace-nowrap text-[0.8em] tabular-nums ${changeColor(quote.change)}`}>{formatPercent(quote.changePercent)}</p>
              )}
            </div>
          </div>
        )}
      </BoxCard>
    </Link>
  );
}
