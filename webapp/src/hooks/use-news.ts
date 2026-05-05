import { useQuery } from "@tanstack/react-query";
import { useSetting } from "./use-supabase-queries";
import { DEFAULT_NEWS_SOURCES } from "@/lib/news-providers";

export interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  image?: string;
  category?: string;
  source: string;
  sourceName: string;
}

export function useNewsSources() {
  return useSetting<string[]>("news_sources", DEFAULT_NEWS_SOURCES);
}

export interface NewsProviderSummary {
  id: string;
  name: string;
  lang: "de" | "en";
  homepage?: string;
}

/**
 * Lists every RSS source Kinboard knows about. Used by the picker on
 * /settings/news. Cached for the session — providers don't change at
 * runtime, only on a Kinboard release.
 */
export function useNewsProviders() {
  return useQuery({
    queryKey: ["news-providers"],
    queryFn: async (): Promise<NewsProviderSummary[]> => {
      const r = await fetch("/api/news/providers");
      if (!r.ok) throw new Error(`news/providers: ${r.status}`);
      const data = await r.json();
      return data.providers;
    },
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}

export function useNews() {
  const { data: sources } = useNewsSources();
  const sourcesParam = (sources && sources.length > 0 ? sources : DEFAULT_NEWS_SOURCES).join(",");

  return useQuery({
    queryKey: ["news", sourcesParam],
    queryFn: async (): Promise<NewsItem[]> => {
      const response = await fetch(`/api/news?sources=${encodeURIComponent(sourcesParam)}`);
      if (!response.ok) {
        throw new Error("Failed to fetch news");
      }
      const data = await response.json();
      return data.news;
    },
    enabled: !!sourcesParam,
    refetchInterval: 10 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });
}
