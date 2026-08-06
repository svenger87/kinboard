"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { ShoppingCart, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard } from "@/components/widget-card";
import { ChecklistItem } from "@/components/checklist-item";
import { useShoppingItems, useUpdateShoppingItem } from "@/hooks";
import { toast } from "sonner";

interface ShoppingWidgetProps {
  maxItems?: number;
  className?: string;
}

function ShoppingWidgetSkeleton() {
  const t = useTranslations("shoppingWidget");
  return (
    <Card aria-label={t("loadingAria")} aria-busy="true" className="accent-border-top h-full">
      <CardContent className="flex flex-col gap-2 p-4">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-[52px] w-full rounded-xl" />
        <Skeleton className="h-[52px] w-full rounded-xl" />
        <Skeleton className="h-[52px] w-3/4 rounded-xl" />
      </CardContent>
    </Card>
  );
}

export function ShoppingWidget({ maxItems = 4, className = "" }: ShoppingWidgetProps) {
  const t = useTranslations("shoppingWidget");
  const { data: items, isLoading, isError } = useShoppingItems();
  const updateItem = useUpdateShoppingItem();

  const openItems = useMemo(
    () => (items || []).filter((i) => !i.checked),
    [items]
  );
  const displayItems = openItems.slice(0, maxItems);
  const totalOpen = openItems.length;

  const handleToggle = async (id: string) => {
    try {
      await updateItem.mutateAsync({ id, checked: true });
    } catch {
      toast.error(t("toastUpdateFailed"));
    }
  };

  if (isLoading) {
    return <ShoppingWidgetSkeleton />;
  }

  if (isError) {
    return (
      <Card className={`accent-border-top h-full ${className}`}>
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-3">
            <span className="icon-badge">
              <ShoppingCart className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h3 className="flex-1 font-display text-lg font-semibold leading-tight">{t("title")}</h3>
          </div>
          <p className="text-sm text-muted-foreground">{t("errorMessage")}</p>
        </CardContent>
      </Card>
    );
  }

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.05 } },
  };
  const item = {
    hidden: { opacity: 0, y: 6 },
    show: { opacity: 1, y: 0, transition: { duration: 0.22 } },
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.5 }}>
      <WidgetCard
        icon={ShoppingCart}
        title={t("title")}
        headerRight={
          totalOpen > 0 ? (
            <Badge variant="neutral" className="tabular-nums">{t("openCount", { count: totalOpen })}</Badge>
          ) : (
            <Link href="/shopping" className="rounded-lg p-1 transition-colors hover:bg-accent/50" aria-label={t("viewAllAria")}>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          )
        }
        className={`h-full ${className}`}
      >
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-2">
          {displayItems.map((it) => (
            <motion.div key={it.id} variants={item}>
              <ChecklistItem
                checked={false}
                onCheckedChange={() => handleToggle(it.id)}
                label={it.name}
                meta={it.quantity ? <span className="tabular-nums">{it.quantity}{it.unit ? ` ${it.unit}` : ""}</span> : undefined}
              />
            </motion.div>
          ))}
          {displayItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
              <ShoppingCart className="mb-2 size-8 text-primary/20" strokeWidth={1.75} />
              <p className="text-sm">{t("emptyState")}</p>
            </div>
          )}
        </motion.div>
        {totalOpen > maxItems && (
          <Link href="/shopping" className="mt-3 flex w-full items-center justify-center gap-1 border-t border-border/40 pt-3 text-sm text-primary/70 transition-colors hover:text-primary">
            <span>{t("moreCount", { count: totalOpen - maxItems })}</span>
            <ChevronRight className="size-3" />
          </Link>
        )}
      </WidgetCard>
    </motion.div>
  );
}

export { ShoppingWidgetSkeleton };
