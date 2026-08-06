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
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getDriver } from "@/plugins/stonks/drivers/registry";

export default function StonksPage() {
  const t = useTranslations("stonks");
  const router = useRouter();
  const { data: tickers = [], isPending, error, refetch } = useTickers();
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId && tickers.length > 0) setActiveId(tickers[0].id);
  }, [tickers, activeId]);

  if (isPending) {
    return (
      <main id="main-content" className="p-4 md:p-8 max-w-2xl mx-auto space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </main>
    );
  }

  if (tickers.length === 0) {
    return (
      <main id="main-content" className="p-4 md:p-8 max-w-2xl mx-auto">
        <PageHeader title={t("title")} icon={LineChart} />
        {/* A failed fetch also lands here with an empty list — offering
            "add your first ticker" would be the wrong thing to do. */}
        {error ? (
          <ErrorState onRetry={() => refetch()} />
        ) : (
          <EmptyState
            icon={LineChart}
            title={t("emptyState")}
            action={{ label: t("addFirst"), onClick: () => router.push("/settings/stonks") }}
          />
        )}
      </main>
    );
  }

  const active = tickers.find((tk) => tk.id === activeId) ?? tickers[0];
  const driver = getDriver("yahoo-finance");

  return (
    <main id="main-content" className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
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
          {/* Scrollable: one trigger per ticker overflows a phone screen. */}
          <TabsList className="w-full justify-start overflow-x-auto">
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
        <Card className="p-6">{t("driverMissing")}</Card>
      )}
    </main>
  );
}
