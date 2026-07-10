"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { LineChart } from "lucide-react";
import { useTickers } from "@/hooks/use-tickers";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { getDriver } from "@/plugins/stonks/drivers/registry";

export default function StonksPage() {
  const t = useTranslations("stonks");
  const router = useRouter();
  const { data: tickers = [], isPending } = useTickers();
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId && tickers.length > 0) setActiveId(tickers[0].id);
  }, [tickers, activeId]);

  if (isPending) {
    return <div className="p-8 text-muted-foreground">{t("loading")}</div>;
  }

  if (tickers.length === 0) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <PageHeader title={t("title")} icon={LineChart} />
        <EmptyState
          icon={LineChart}
          title={t("emptyState")}
          action={{ label: t("addFirst"), onClick: () => router.push("/settings/stonks") }}
        />
      </div>
    );
  }

  const active = tickers.find((tk) => tk.id === activeId) ?? tickers[0];
  const driver = getDriver("yahoo-finance");

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t("title")}
        icon={LineChart}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/stonks">{t("manage")}</Link>
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
        <GlassCard className="p-6">{t("driverMissing")}</GlassCard>
      )}
    </div>
  );
}
