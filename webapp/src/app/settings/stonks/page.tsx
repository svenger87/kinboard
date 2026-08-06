"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { LineChart, Plus, Trash2, Search, Check, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTickers, useCreateTicker, useDeleteTicker, useUpdateTicker } from "@/hooks/use-tickers";
import { useSymbolSearch } from "@/hooks/use-stonks";
import { getDriver } from "@/plugins/stonks/drivers/registry";

const driver = getDriver("yahoo-finance");
const DriverConfigForm = driver?.ConfigForm;

export default function StonksSettingsPage() {
  const t = useTranslations("settings.stonks");
  const { data: tickers = [], isPending } = useTickers();
  const createTicker = useCreateTicker();
  const updateTicker = useUpdateTicker();
  const deleteTicker = useDeleteTicker();

  const [query, setQuery] = useState("");
  const { data: results = [], isPending: searching } = useSymbolSearch(query);

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={LineChart}
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings"
        />

        <p className="text-sm text-muted-foreground">{t("intro")}</p>

        {/* Add symbol */}
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="font-medium mb-2">{t("addHeading")}</h3>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="pl-9"
              />
            </div>
          </div>

          {searching && query && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-2 max-h-72 overflow-auto">
              {results.map((r) => {
                const alreadyAdded = tickers.some((tk) => tk.symbol === r.symbol);
                return (
                  <button
                    key={r.symbol}
                    type="button"
                    disabled={alreadyAdded || createTicker.isPending}
                    onClick={() =>
                      createTicker
                        .mutateAsync({
                          symbol: r.symbol,
                          asset_type: r.assetType,
                          // Default the nickname to the search result's name so
                          // the /stonks tabs and dashboard widget show "Apple Inc."
                          // instead of bare "AAPL". Users can rename later in
                          // the per-row config form.
                          nickname: r.name,
                        })
                        .then(() => setQuery(""))
                        .catch(() => toast.error(t("addFailed")))
                    }
                    className="w-full flex items-center justify-between gap-3 p-3 rounded-md border border-border hover:bg-muted/30 disabled:opacity-50 disabled:cursor-not-allowed text-left"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.symbol}</span>
                        <Badge variant="outline" className="text-3xs py-0 px-1.5">
                          {r.assetType}
                        </Badge>
                        {r.exchange && (
                          <span className="text-xs text-muted-foreground">{r.exchange}</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{r.name}</p>
                    </div>
                    {alreadyAdded ? (
                      <Check className="size-5 text-success shrink-0" />
                    ) : (
                      <Plus className="size-5 text-muted-foreground shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {/* Watchlist */}
        <div className="space-y-2">
          <h3 className="font-medium">{t("watchlistHeading")}</h3>
          {isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : tickers.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              {t("emptyWatchlist")}
            </Card>
          ) : (
            <AnimatePresence>
              {tickers.map((tk) => (
                <motion.div
                  key={tk.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                >
                  <Card className="p-4">
                    <div className="flex items-center gap-3">
                      <GripVertical className="size-4 text-muted-foreground/40 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{tk.symbol}</span>
                          <Badge variant="outline" className="text-3xs py-0 px-1.5">
                            {tk.asset_type}
                          </Badge>
                          {tk.nickname && (
                            <span className="text-xs text-muted-foreground">
                              &quot;{tk.nickname}&quot;
                            </span>
                          )}
                        </div>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" aria-label={t("deleteAria", { symbol: tk.symbol })}>
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("confirmDeleteDescription", { symbol: tk.symbol })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("cancelButton")}</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => deleteTicker.mutateAsync(tk.id).catch(() => toast.error(t("deleteFailed")))}
                            >
                              {t("deleteButton")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    {DriverConfigForm && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <DriverConfigForm
                          ticker={tk}
                          onChange={(patch) =>
                            updateTicker.mutateAsync({ id: tk.id, update: patch })
                          }
                        />
                      </div>
                    )}
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </main>
  );
}
