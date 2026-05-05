"use client";

import { motion } from "framer-motion";
import { Newspaper, RefreshCw, Settings as SettingsIcon, ExternalLink } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { useState, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { de, enUS } from "date-fns/locale";
import Link from "next/link";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { useNews, type NewsItem } from "@/hooks/use-news";
import { useKeyboardShortcuts, useSwipeNavigation } from "@/hooks";
import { NewsArticleSheet } from "@/components/news-article-sheet";

function dateLocale(localeCode: string) {
  return localeCode === "de" ? de : enUS;
}

export default function NewsPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const t = useTranslations("news");
  const locale = useLocale();
  const { data: news, isLoading, isFetching, refetch } = useNews();

  const [query, setQuery] = useState("");
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [openArticle, setOpenArticle] = useState<NewsItem | null>(null);

  const sources = useMemo(() => {
    if (!news) return [];
    const set = new Map<string, string>();
    for (const n of news) set.set(n.source, n.sourceName);
    return Array.from(set.entries()).map(([id, name]) => ({ id, name }));
  }, [news]);

  const filtered = useMemo(() => {
    if (!news) return [];
    let out = news;
    if (activeSource) out = out.filter((n) => n.source === activeSource);
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          (n.description?.toLowerCase().includes(q) ?? false),
      );
    }
    return out;
  }, [news, query, activeSource]);

  return (
    <main id="main-content" className="min-h-screen p-4 md:p-8 relative safe-area-inset">
      <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />

      <div className="relative z-10 max-w-3xl mx-auto pb-20">
        <PageHeader
          icon={Newspaper}
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/"
        />

        {/* Toolbar */}
        <div className="flex flex-wrap gap-2 items-center mb-6">
          <Input
            type="search"
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 min-w-[200px]"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label={t("refresh")}
          >
            <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button asChild variant="outline" size="icon" aria-label={t("manageSources")}>
            <Link href="/settings/news">
              <SettingsIcon className="size-4" />
            </Link>
          </Button>
        </div>

        {/* Source pills */}
        {sources.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-4">
            <Badge
              variant={activeSource === null ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setActiveSource(null)}
            >
              {t("allSources")}
            </Badge>
            {sources.map((s) => (
              <Badge
                key={s.id}
                variant={activeSource === s.id ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setActiveSource(s.id)}
              >
                {s.name}
              </Badge>
            ))}
          </div>
        )}

        {/* Articles */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <GlassCard className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {news && news.length === 0 ? t("emptyNoSources") : t("emptyFiltered")}
            </p>
            {news && news.length === 0 && (
              <Button asChild variant="outline" className="mt-4">
                <Link href="/settings/news">{t("manageSources")}</Link>
              </Button>
            )}
          </GlassCard>
        )}

        {!isLoading && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((item) => (
              <NewsCard
                key={item.link}
                item={item}
                locale={locale}
                onOpen={() => setOpenArticle(item)}
              />
            ))}
          </div>
        )}
      </div>

      <NewsArticleSheet
        url={openArticle?.link ?? null}
        open={!!openArticle}
        onOpenChange={(o) => !o && setOpenArticle(null)}
        fallbackSourceName={openArticle?.sourceName}
      />
    </main>
  );
}

function NewsCard({
  item,
  locale,
  onOpen,
}: {
  item: NewsItem;
  locale: string;
  onOpen: () => void;
}) {
  const t = useTranslations("news");
  const relativeDate = item.pubDate
    ? formatDistanceToNow(new Date(item.pubDate), {
        addSuffix: true,
        locale: dateLocale(locale),
      })
    : "";

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <button
        onClick={onOpen}
        className="block w-full text-left"
        type="button"
      >
        <GlassCard className="p-4 hover:bg-muted/30 transition-colors">
          <div className="flex gap-4">
            {item.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.image}
                alt=""
                className="size-24 shrink-0 rounded-md object-cover bg-muted"
                loading="lazy"
              />
            )}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                  {item.sourceName}
                </Badge>
                {relativeDate && <span>· {relativeDate}</span>}
              </div>
              <h3 className="font-medium leading-tight line-clamp-2">{item.title}</h3>
              {item.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {item.description}
                </p>
              )}
              <div className="pt-2 flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-xs text-month-primary">
                  {t("readArticle")}
                </span>
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  aria-label={t("openOriginal")}
                >
                  <ExternalLink className="size-3" />
                </a>
              </div>
            </div>
          </div>
        </GlassCard>
      </button>
    </motion.article>
  );
}
