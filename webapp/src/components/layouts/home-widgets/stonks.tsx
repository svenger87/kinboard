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
import { HomeCard, HomeEmptyLine, HomeSetUp, HOME_CARD_CORNER } from "./frame";
import { CapFit, useShrinkStep } from "./rest-shared";

/** As the card: one ticker at a time, the next every eight seconds. */
const ROTATE_INTERVAL_MS = 8000;

/** Richest first: price, change and its arrow; the price and change; the price alone. The ticker's name is the title. */
const STEPS = ["full", "figures", "price"] as const;

/**
 * The stonks card in a box (RFC-022 §3.1, fixed): the shared title row
 * with a ticker's name (as the card heads it), its price large and the day's change, each ticker in turn as on the card,
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
    return <HomeSetUp icon={LineChart} title={t("stonksName")} description={t("stonksDisabled")} href="/settings/plugins" testId="home-stonks" />;
  }
  if (!tk) {
    return <HomeSetUp icon={LineChart} title={t("stonksName")} description={t("stonksEmpty")} href="/stonks" testId="home-stonks" />;
  }

  const name = tk.nickname ?? tk.symbol;
  return (
    <Link href="/stonks" className={`block size-full ${HOME_CARD_CORNER} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`} data-testid="home-stonks">
      <HomeCard ref={ref} step={step} icon={LineChart} title={name} chevron bodyClassName={`justify-end ${isPending ? "animate-pulse" : ""}`}>
        {!quote ? (
          !isPending && <HomeEmptyLine text={tYahoo("quoteUnavailable")} />
        ) : (
          <CapFit box={box} active={step === STEPS.length - 1} deps={[quote.price]}>
          <div className="flex min-w-0 flex-col gap-[0.15em]">
            <div className="flex flex-col">
              <p className="flex items-center gap-[0.2em] whitespace-nowrap home-display font-bold leading-tight tabular-nums">
                {formatPrice(quote.price, quote.currency)}
                {s === "full" && <ChangeIcon delta={quote.change} className={`size-[0.5em] shrink-0 ${changeColor(quote.change)}`} />}
              </p>
              {s !== "price" && (
                <p className={`whitespace-nowrap home-body tabular-nums ${changeColor(quote.change)}`}>{formatPercent(quote.changePercent)}</p>
              )}
            </div>
          </div>
          </CapFit>
        )}
      </HomeCard>
    </Link>
  );
}
