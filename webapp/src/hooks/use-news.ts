import { useQuery } from "@tanstack/react-query";
import { useSetting } from "./use-supabase-queries";
import { useFamilyStore } from "@/stores/family-store";
import { DEFAULT_NEWS_SOURCES, type CustomFeed } from "@/lib/news-providers";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

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
  return useSetting<string[]>(SETTINGS_KEYS.newsSources, DEFAULT_NEWS_SOURCES);
}

/**
 * The family's own RSS feeds. Stored separately from `news_sources`
 * because the two answer different questions — this one is "which feeds
 * exist", `news_sources` is "which are switched on" — and a feed you
 * toggled off shouldn't have to be re-added and re-tested to come back.
 */
export function useCustomFeeds() {
  return useSetting<CustomFeed[]>(SETTINGS_KEYS.newsCustomFeeds, []);
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
  const { family } = useFamilyStore();
  const familyId = family?.id ?? "";
  const sourcesParam = (sources && sources.length > 0 ? sources : DEFAULT_NEWS_SOURCES).join(",");

  return useQuery({
    // Custom feeds resolve per family, so the family is part of the key —
    // otherwise switching families on one device would serve the previous
    // family's articles from cache.
    queryKey: ["news", sourcesParam, familyId],
    queryFn: async (): Promise<NewsItem[]> => {
      const response = await fetch(
        `/api/news?sources=${encodeURIComponent(sourcesParam)}` +
          (familyId ? `&family_id=${encodeURIComponent(familyId)}` : ""),
      );
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
