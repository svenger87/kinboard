// Catalog of news sources Kinboard knows how to fetch. RSS-only for now;
// users pick a subset on /settings/news. The maintainer's deployment
// originally defaulted to Der Spiegel — kept as the fallback when no
// `news_sources` setting exists yet.

export interface NewsProvider {
  id: string;
  name: string;
  url: string;
  /** Display language; used for grouping in the picker UI */
  lang: "de" | "en";
  /** Optional homepage for the "what is this source?" affordance */
  homepage?: string;
}

export const NEWS_PROVIDERS: NewsProvider[] = [
  // German
  {
    id: "spiegel",
    name: "Der Spiegel",
    url: "https://www.spiegel.de/schlagzeilen/index.rss",
    lang: "de",
    homepage: "https://www.spiegel.de/",
  },
  {
    id: "tagesschau",
    name: "Tagesschau",
    url: "https://www.tagesschau.de/index~rss2.xml",
    lang: "de",
    homepage: "https://www.tagesschau.de/",
  },
  {
    id: "zeit",
    name: "Die Zeit",
    url: "https://newsfeed.zeit.de/index",
    lang: "de",
    homepage: "https://www.zeit.de/",
  },
  {
    id: "heise",
    name: "heise online",
    url: "https://www.heise.de/rss/heise-atom.xml",
    lang: "de",
    homepage: "https://www.heise.de/",
  },
  {
    id: "sueddeutsche",
    name: "Süddeutsche Zeitung",
    url: "https://rss.sueddeutsche.de/alles",
    lang: "de",
    homepage: "https://www.sueddeutsche.de/",
  },
  // English
  {
    id: "bbc",
    name: "BBC News",
    url: "http://feeds.bbci.co.uk/news/rss.xml",
    lang: "en",
    homepage: "https://www.bbc.com/news",
  },
  {
    id: "guardian",
    name: "The Guardian",
    url: "https://www.theguardian.com/international/rss",
    lang: "en",
    homepage: "https://www.theguardian.com/",
  },
  {
    id: "nyt",
    name: "NYT Home",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
    lang: "en",
    homepage: "https://www.nytimes.com/",
  },
  {
    id: "hn",
    name: "Hacker News",
    url: "https://news.ycombinator.com/rss",
    lang: "en",
    homepage: "https://news.ycombinator.com/",
  },
  {
    id: "ars-technica",
    name: "Ars Technica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
    lang: "en",
    homepage: "https://arstechnica.com/",
  },
];

export const DEFAULT_NEWS_SOURCES: string[] = ["spiegel"];

export function getProvider(id: string): NewsProvider | undefined {
  return NEWS_PROVIDERS.find((p) => p.id === id);
}
