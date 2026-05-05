"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations, useLocale } from "next-intl";
import { ExternalLink, Loader2, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { de, enUS } from "date-fns/locale";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface ArticleResult {
  readable: boolean;
  url: string;
  title?: string;
  byline?: string | null;
  excerpt?: string | null;
  siteName?: string | null;
  publishedAt?: string | null;
  contentHtml?: string;
  textContent?: string;
  lengthChars?: number;
  reason?: string;
}

function dateLocale(localeCode: string) {
  return localeCode === "de" ? de : enUS;
}

interface NewsArticleSheetProps {
  url: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Source name shown in the sheet header before the article loads */
  fallbackSourceName?: string;
  /** Set to true when opening above the screensaver (z-[100]); bumps the
   *  Sheet content z-index above it. */
  elevated?: boolean;
}

export function NewsArticleSheet({
  url,
  open,
  onOpenChange,
  fallbackSourceName,
  elevated,
}: NewsArticleSheetProps) {
  const t = useTranslations("news.reader");
  const locale = useLocale();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["news-article", url],
    queryFn: async (): Promise<ArticleResult> => {
      const r = await fetch(`/api/news/article?url=${encodeURIComponent(url!)}`);
      if (!r.ok) throw new Error(`reader: ${r.status}`);
      return r.json();
    },
    enabled: !!url && open,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const formattedDate =
    data?.publishedAt && !isNaN(new Date(data.publishedAt).getTime())
      ? format(new Date(data.publishedAt), "PPP", { locale: dateLocale(locale) })
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={`w-full sm:max-w-2xl p-0 overflow-y-auto ${elevated ? "!z-[110]" : ""}`}
      >
        <div className="flex flex-col h-full">
          <SheetHeader className="px-6 py-4 border-b sticky top-0 bg-background/95 backdrop-blur z-10">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <SheetTitle className="text-base text-left line-clamp-2">
                  {data?.title || fallbackSourceName || t("loading")}
                </SheetTitle>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {data?.siteName ?? fallbackSourceName}
                  {data?.byline && ` · ${data.byline}`}
                  {formattedDate && ` · ${formattedDate}`}
                </p>
              </div>
              {url && (
                <Button asChild variant="ghost" size="icon" aria-label={t("openOriginal")}>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              )}
            </div>
          </SheetHeader>

          <div className="flex-1 px-6 py-6">
            {isLoading && (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {!isLoading && (isError || (data && !data.readable)) && (
              <div className="space-y-4 py-10 text-center">
                <AlertCircle className="size-8 mx-auto text-amber-500" strokeWidth={1.5} />
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("notReadable")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("notReadableDescription")}
                  </p>
                </div>
                {url && (
                  <Button asChild variant="default">
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-4 mr-2" />
                      {t("openOriginal")}
                    </a>
                  </Button>
                )}
              </div>
            )}

            {!isLoading && data?.readable && data.contentHtml && (
              <article
                className="prose prose-sm dark:prose-invert max-w-none
                  prose-headings:font-display prose-headings:tracking-tight
                  prose-a:text-month-primary prose-a:no-underline hover:prose-a:underline
                  prose-img:rounded-md
                  prose-p:leading-relaxed"
                // The HTML has been DOMPurify-sanitized server-side with
                // an allowlist of safe tags + attributes; raw markup is
                // safe to inject here.
                dangerouslySetInnerHTML={{ __html: data.contentHtml }}
              />
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
