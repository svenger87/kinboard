"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { LineChart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTickers } from "@/hooks/use-tickers";
import { useIsPluginEnabled } from "@/hooks/use-enabled-plugins";
import { getDriver } from "@/plugins/stonks/drivers/registry";
import { PluginDiscoverCard } from "./plugin-discover-card";

const ROTATE_INTERVAL_MS = 8000;

export function StonksWidget() {
  const t = useTranslations("dashboard.pluginDiscover");
  const enabled = useIsPluginEnabled("stonks");
  const { data: tickers = [] } = useTickers();
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (tickers.length <= 1) return;
    const id = setInterval(() => {
      setActiveIdx((i) => (i + 1) % tickers.length);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tickers.length]);

  if (!enabled) {
    return (
      <PluginDiscoverCard
        pluginId="stonks"
        icon={LineChart}
        title={t("stonksName")}
        description={t("stonksDisabled")}
        ctaLabel={t("enableCta")}
        ctaHref="/settings/plugins"
      />
    );
  }
  if (tickers.length === 0) {
    return (
      <PluginDiscoverCard
        pluginId="stonks"
        icon={LineChart}
        title={t("stonksName")}
        description={t("stonksEmpty")}
        ctaLabel={t("addCta")}
        ctaHref="/stonks"
      />
    );
  }

  // Clamp activeIdx if tickers list shrank
  const safeIdx = activeIdx >= tickers.length ? 0 : activeIdx;
  const tk = tickers[safeIdx];
  const driver = getDriver("yahoo-finance");
  if (!driver) return null;

  const WidgetCard = driver.WidgetCard;

  return (
    <Link href="/stonks" className="block h-full">
      <AnimatePresence mode="wait">
        <motion.div
          key={tk.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
        >
          <WidgetCard ticker={tk} />
        </motion.div>
      </AnimatePresence>
    </Link>
  );
}
