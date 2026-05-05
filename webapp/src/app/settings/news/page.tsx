"use client";

import { motion } from "framer-motion";
import { Newspaper, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useEffect, useMemo } from "react";
import { GlassCard } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { useUpdateSetting } from "@/hooks";
import { useNewsSources, useNewsProviders } from "@/hooks/use-news";

export default function NewsSettingsPage() {
  const t = useTranslations("settings.news");
  const tCommon = useTranslations("common");
  const { data: providers, isLoading: providersLoading } = useNewsProviders();
  const { data: savedSources } = useNewsSources();
  const updateSetting = useUpdateSetting<string[]>();

  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (savedSources) {
      setSelected(new Set(savedSources));
    }
  }, [savedSources]);

  const grouped = useMemo(() => {
    if (!providers) return { de: [], en: [] };
    const de = providers.filter((p) => p.lang === "de");
    const en = providers.filter((p) => p.lang === "en");
    return { de, en };
  }, [providers]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    updateSetting.mutate({
      key: "news_sources",
      value: Array.from(next),
    });
  }

  const noneSelected = selected.size === 0;

  return (
    <main id="main-content" className="min-h-screen p-4 md:p-8 relative safe-area-inset">
      <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />

      <div className="relative z-10 max-w-2xl mx-auto">
        <PageHeader
          icon={Newspaper}
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings"
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-6"
        >
          {noneSelected && providers && (
            <GlassCard className="p-4 border-amber-500/30 bg-amber-500/5">
              <p className="text-sm">{t("noneSelectedHint")}</p>
            </GlassCard>
          )}

          {(["de", "en"] as const).map((lang) => (
            <div key={lang}>
              <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
                {t(`lang_${lang}`)}
              </h2>
              <GlassCard className="p-2 divide-y divide-border/50">
                {providersLoading && (
                  <div className="p-3 space-y-3">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                  </div>
                )}
                {!providersLoading &&
                  grouped[lang].map((p) => {
                    const isOn = selected.has(p.id);
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-3 p-3"
                      >
                        <div className="flex-1 min-w-0">
                          <Label
                            htmlFor={`news-source-${p.id}`}
                            className="cursor-pointer font-medium"
                          >
                            {p.name}
                          </Label>
                          {p.homepage && (
                            <a
                              href={p.homepage}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 inline-flex items-center text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <ExternalLink className="size-3" />
                            </a>
                          )}
                        </div>
                        <Switch
                          id={`news-source-${p.id}`}
                          checked={isOn}
                          onCheckedChange={() => toggle(p.id)}
                          aria-label={p.name}
                        />
                      </div>
                    );
                  })}
              </GlassCard>
            </div>
          ))}

          <p className="text-xs text-muted-foreground text-center pt-2">
            {t("changesAutosave")} · {tCommon("seeOnDashboardOrNewsPage")}
          </p>
        </motion.div>
      </div>
    </main>
  );
}
