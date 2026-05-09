"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { LineChart, Plus } from "lucide-react";
import { useTickers } from "@/hooks/use-tickers";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { getDriver } from "@/plugins/stonks/drivers/registry";

export default function StonksPage() {
  const t = useTranslations("stonks" as never);
  const { data: tickers = [], isPending } = useTickers();
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId && tickers.length > 0) setActiveId(tickers[0].id);
  }, [tickers, activeId]);

  if (isPending) {
    return <div className="p-8 text-muted-foreground">{t("loading" as never)}</div>;
  }

  if (tickers.length === 0) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <PageHeader title={t("title" as never)} icon={LineChart} />
        <GlassCard className="p-8 text-center space-y-4">
          <p className="text-muted-foreground">{t("emptyState" as never)}</p>
          <Button asChild>
            <Link href="/settings/stonks">
              <Plus className="size-4 mr-2" />
              {t("addFirst" as never)}
            </Link>
          </Button>
        </GlassCard>
      </div>
    );
  }

  const active = tickers.find((tk) => tk.id === activeId) ?? tickers[0];
  const driver = getDriver("yahoo-finance");

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t("title" as never)}
        icon={LineChart}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/stonks">{t("manage" as never)}</Link>
          </Button>
        }
      />

      {tickers.length > 1 && (
        <Tabs value={active.id} onValueChange={setActiveId}>
          <TabsList>
            {tickers.map((tk) => (
              <TabsTrigger key={tk.id} value={tk.id}>
                {tk.nickname ?? tk.symbol}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {driver ? (
        <motion.div
          key={active.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <driver.Card ticker={active} />
        </motion.div>
      ) : (
        <GlassCard className="p-6">{t("driverMissing" as never)}</GlassCard>
      )}
    </div>
  );
}
