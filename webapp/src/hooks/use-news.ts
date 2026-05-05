import { useQuery } from "@tanstack/react-query";

export interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  image?: string;
  category?: string;
}

export function useNews() {
  return useQuery({
    queryKey: ["news"],
    queryFn: async (): Promise<NewsItem[]> => {
      const response = await fetch("/api/news");
      if (!response.ok) {
        throw new Error("Failed to fetch news");
      }
      const data = await response.json();
      return data.news;
    },
    refetchInterval: 10 * 60 * 1000, // Refetch every 10 minutes
    staleTime: 5 * 60 * 1000, // Consider stale after 5 minutes
  });
}
