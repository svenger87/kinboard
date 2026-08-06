"use client";

import { motion } from "framer-motion";
import {
  Newspaper,
  ExternalLink,
  Plus,
  Trash2,
  Rss,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { useUpdateSetting } from "@/hooks";
import { useNewsSources, useNewsProviders, useCustomFeeds } from "@/hooks/use-news";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { safeRandomUUID } from "@/lib/uuid";
import { CUSTOM_FEED_PREFIX, type CustomFeed } from "@/lib/news-providers";

const MAX_CUSTOM_FEEDS = 20;

interface TestResult {
  ok: boolean;
  url?: string;
  title?: string;
  itemCount?: number;
  firstItemTitle?: string | null;
  discovered?: boolean;
  error?: string;
}

export default function NewsSettingsPage() {
  const t = useTranslations("settings.news");
  const tCommon = useTranslations("common");
  const { data: providers, isLoading: providersLoading } = useNewsProviders();
  const { data: savedSources } = useNewsSources();
  const { data: savedFeeds } = useCustomFeeds();
  const updateSources = useUpdateSetting<string[]>();
  const updateFeeds = useUpdateSetting<CustomFeed[]>();

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Add-a-feed form. Kept inline rather than in a dialog: on the wall
  // display this page is often driven by touch, and a dialog over a
  // list of switches is one more thing to dismiss.
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (savedSources) {
      setSelected(new Set(savedSources));
    }
  }, [savedSources]);

  const feeds = useMemo(() => savedFeeds ?? [], [savedFeeds]);

  const grouped = useMemo(() => {
    if (!providers) return { de: [], en: [] };
    const de = providers.filter((p) => p.lang === "de");
    const en = providers.filter((p) => p.lang === "en");
    return { de, en };
  }, [providers]);

  function persistSources(next: Set<string>) {
    setSelected(next);
    updateSources.mutate(
      { key: SETTINGS_KEYS.newsSources, value: Array.from(next) },
      {
        onError: () => {
          setSelected(new Set(savedSources ?? []));
          toast.error(t("saveFailed"));
        },
      },
    );
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistSources(next);
  }

  function resetForm() {
    setAdding(false);
    setUrl("");
    setName("");
    setTest(null);
  }

  async function runTest() {
    if (!url.trim()) return;
    setTesting(true);
    setTest(null);
    try {
      const r = await fetch("/api/news/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const result: TestResult = await r.json();
      setTest(result);
      if (result.ok) {
        // Autodiscovery may have resolved a page to its feed; show the
        // address that actually worked so it's clear what gets saved.
        if (result.url) setUrl(result.url);
        if (!name.trim() && result.title) setName(result.title);
      }
    } catch {
      setTest({ ok: false, error: t("testFailed") });
    } finally {
      setTesting(false);
    }
  }

  async function addFeed() {
    if (!test?.ok || !test.url) return;
    if (feeds.length >= MAX_CUSTOM_FEEDS) {
      toast.error(t("limitReached", { max: MAX_CUSTOM_FEEDS }));
      return;
    }
    if (feeds.some((f) => f.url === test.url)) {
      toast.error(t("duplicateFeed"));
      return;
    }

    setSaving(true);
    try {
      // `safeRandomUUID`, not `crypto.randomUUID`: the latter exists only
      // in a secure context, so on a plain-HTTP LAN deployment — which is
      // how most of Kinboard runs — it is undefined. Calling it here threw
      // before the try block, so Add appeared to do nothing at all: no
      // feed, no error, just the button animation. See lib/uuid.ts, which
      // exists because the same thing once broke the setup wizard.
      const feed: CustomFeed = {
        id: `${CUSTOM_FEED_PREFIX}${safeRandomUUID()}`,
        name: (name.trim() || test.title || new URL(test.url).hostname).slice(0, 80),
        url: test.url,
      };

      await updateFeeds.mutateAsync({
        key: SETTINGS_KEYS.newsCustomFeeds,
        value: [...feeds, feed],
      });
      // A feed you just added and tested is one you want to read, so it
      // arrives switched on rather than requiring a second tap.
      const next = new Set(selected);
      next.add(feed.id);
      persistSources(next);
      toast.success(t("toastAdded"));
      resetForm();
    } catch (err) {
      // Every failure path ends here now — a silent one is what made this
      // bug unreportable in the first place.
      console.error("[news] adding a custom feed failed:", err);
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function removeFeed(feed: CustomFeed) {
    try {
      await updateFeeds.mutateAsync({
        key: SETTINGS_KEYS.newsCustomFeeds,
        value: feeds.filter((f) => f.id !== feed.id),
      });
      // Drop it from the selection too, or the id lingers there forever
      // as an unresolvable source.
      const next = new Set(selected);
      next.delete(feed.id);
      persistSources(next);
      toast.success(t("toastDeleted"));
    } catch {
      toast.error(t("saveFailed"));
    }
  }

  const noneSelected = selected.size === 0;

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
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
            <Card className="p-4 border-warning/30 bg-warning/5">
              <p className="text-sm">{t("noneSelectedHint")}</p>
            </Card>
          )}

          {/* Own feeds first: it's the part of this page people come back
              to, while the catalog is a one-time set-and-forget. */}
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-3 px-1">
              <h2 className="text-sm font-medium text-muted-foreground">
                {t("customTitle")}
              </h2>
              {!adding && feeds.length < MAX_CUSTOM_FEEDS && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 -mr-2"
                  onClick={() => setAdding(true)}
                >
                  <Plus className="size-4 mr-1" />
                  {t("addButton")}
                </Button>
              )}
            </div>

            <Card className="p-2 divide-y divide-border/50">
              {feeds.length === 0 && !adding && (
                <p className="p-3 text-sm text-muted-foreground">{t("customEmpty")}</p>
              )}

              {feeds.map((feed) => (
                <div key={feed.id} className="flex items-center gap-3 p-3">
                  <Rss className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <Label
                      htmlFor={`news-source-${feed.id}`}
                      className="cursor-pointer font-medium block truncate"
                    >
                      {feed.name}
                    </Label>
                    <span className="text-2xs text-muted-foreground block truncate">
                      {feed.url}
                    </span>
                  </div>
                  <Switch
                    id={`news-source-${feed.id}`}
                    checked={selected.has(feed.id)}
                    onCheckedChange={() => toggle(feed.id)}
                    aria-label={feed.name}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeFeed(feed)}
                    aria-label={t("deleteAria")}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}

              {adding && (
                <div className="p-3 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="feed-url">{t("urlLabel")}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="feed-url"
                        value={url}
                        onChange={(e) => {
                          setUrl(e.target.value);
                          // Any edit invalidates the previous result —
                          // otherwise you could test one address and add
                          // another.
                          setTest(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void runTest();
                          }
                        }}
                        placeholder={t("urlPlaceholder")}
                        inputMode="url"
                        autoComplete="off"
                        autoFocus
                      />
                      <Button
                        variant="secondary"
                        onClick={() => void runTest()}
                        disabled={testing || !url.trim()}
                      >
                        {testing ? (
                          <>
                            <Loader2 className="size-4 mr-1 animate-spin" />
                            {t("testingLabel")}
                          </>
                        ) : (
                          t("testButton")
                        )}
                      </Button>
                    </div>
                  </div>

                  {test && (
                    <div
                      className={`flex items-start gap-2 rounded-md p-2.5 text-sm ${
                        test.ok
                          ? "bg-success/10 text-success"
                          : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {test.ok ? (
                        <CheckCircle2 className="size-4 mt-0.5 shrink-0" />
                      ) : (
                        <AlertCircle className="size-4 mt-0.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        {test.ok ? (
                          <>
                            {test.discovered && (
                              <span className="block">{t("testDiscovered")}</span>
                            )}
                            <span className="block">
                              {test.itemCount && test.itemCount > 0
                                ? t("testSuccess", {
                                    count: test.itemCount,
                                    first: test.firstItemTitle ?? "",
                                  })
                                : t("testNoItems")}
                            </span>
                          </>
                        ) : (
                          <span className="block">{test.error ?? t("testFailed")}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {test?.ok && (
                    <div className="space-y-1.5">
                      <Label htmlFor="feed-name">{t("nameLabel")}</Label>
                      <Input
                        id="feed-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t("namePlaceholder")}
                        maxLength={80}
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <span className="text-xs text-muted-foreground">
                      {!test?.ok && t("testFirstHint")}
                    </span>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={resetForm}>
                        {tCommon("cancel")}
                      </Button>
                      <Button onClick={() => void addFeed()} disabled={!test?.ok || saving}>
                        {saving ? (
                          <>
                            <Loader2 className="size-4 mr-1 animate-spin" />
                            {t("savingLabel")}
                          </>
                        ) : (
                          t("saveButton")
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </Card>

            <p className="text-xs text-muted-foreground mt-2 px-1">
              {t("customSubtitle")} {t("readerHint")}
            </p>
          </div>

          <h2 className="text-sm font-medium text-muted-foreground pt-2 px-1">
            {t("catalogTitle")}
          </h2>

          {(["de", "en"] as const).map((lang) => (
            <div key={lang}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 px-1">
                {t(`lang_${lang}`)}
              </h3>
              <Card className="p-2 divide-y divide-border/50">
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
                              className="ml-2 inline-flex items-center text-2xs text-muted-foreground hover:text-foreground transition-colors"
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
              </Card>
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
