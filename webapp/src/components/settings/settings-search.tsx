"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  SETTINGS_ENTRIES,
  entryHref,
  isEntryVisible,
  type SettingsEntry,
  type VisibilityContext,
} from "@/lib/settings-search/registry";
import { searchSettings, toSearchable } from "@/lib/settings-search/search";

/** Kept per tab, so Back from a result comes back to the same results. */
const STORAGE_KEY = "kinboard_settings_search";

function readStored(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function store(query: string) {
  try {
    if (query) sessionStorage.setItem(STORAGE_KEY, query);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode or blocked storage: the search still works, Back just forgets it */
  }
}

/**
 * The search box at the top of the settings index. While it holds a query the
 * menu (`children`) gives way to a ranked list of pages and sections; empty, it
 * shows the menu unchanged. Visibility is the menu's own rule, so a plugin that
 * is switched off is not found either.
 */
export function SettingsSearch({
  visibility,
  descriptionOverrides,
  children,
}: {
  visibility: VisibilityContext;
  /** Descriptions computed at runtime, by entry id (the device's own name). */
  descriptionOverrides?: Record<string, string>;
  children: ReactNode;
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  // After mount, not in the initial state: the server render has no
  // sessionStorage, and the first client render has to match it.
  useEffect(() => {
    const stored = readStored();
    if (stored) setQuery(stored);
  }, []);

  const update = (next: string) => {
    setQuery(next);
    store(next);
  };

  const { pluginEnabled } = visibility;
  const searchable = useMemo(
    () =>
      toSearchable(
        SETTINGS_ENTRIES.filter((e) => isEntryVisible(e, { pluginEnabled })),
        (key) => t(key),
        descriptionOverrides,
      ),
    [t, pluginEnabled, descriptionOverrides],
  );
  const results = useMemo(() => searchSettings(searchable, query), [searchable, query]);
  const byId = useMemo(() => new Map(searchable.map((s) => [s.entry.id, s])), [searchable]);

  /*
    A section of the page we are already on — the PIN, the join code — is a
    hash change, not a navigation: the router keeps the page, nothing
    remounts, and the anchor hook only hears about it through `hashchange`.
    The query is cleared too, so the menu and the section come back into view.
  */
  const openOnThisPage = (entry: SettingsEntry) => {
    update("");
    if (window.location.hash === `#${entry.anchor}`) {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else {
      window.location.hash = entry.anchor!;
    }
  };
  const isOnThisPage = (entry: SettingsEntry) => !!entry.anchor && entry.href === pathname;

  const open = (entry: SettingsEntry) => {
    if (isOnThisPage(entry)) openOnThisPage(entry);
    else router.push(entryHref(entry));
  };

  const active = query.trim().length > 0;

  return (
    <>
      <div className="relative mb-6">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              open(results[0]);
            } else if (e.key === "Escape" && query) {
              e.preventDefault();
              update("");
            }
          }}
          placeholder={t("settingsSearch.placeholder")}
          aria-label={t("settingsSearch.placeholder")}
          className="h-11 pl-9 pr-10 [&::-webkit-search-cancel-button]:hidden"
          data-testid="settings-search-input"
          autoComplete="off"
          enterKeyHint="go"
        />
        {query && (
          <button
            type="button"
            onClick={() => update("")}
            aria-label={t("settingsSearch.clear")}
            className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {!active ? (
        children
      ) : results.length === 0 ? (
        <p className="mb-6 px-1 text-sm text-muted-foreground" data-testid="settings-search-empty" role="status">
          {t("settingsSearch.noResults", { query: query.trim() })}
        </p>
      ) : (
        <ul className="mb-6 grid grid-cols-1 gap-2" data-testid="settings-search-results" aria-label={t("settingsSearch.resultsLabel")}>
          {results.map((entry) => {
            const item = byId.get(entry.id)!;
            const Icon = entry.icon;
            const sameRoute = isOnThisPage(entry);
            return (
              <li key={entry.id}>
                <Link
                  href={entryHref(entry)}
                  onClick={(e) => {
                    if (!sameRoute) return;
                    e.preventDefault();
                    openOnThisPage(entry);
                  }}
                  className="flex min-h-[56px] items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 elev-sm transition-colors hover:bg-accent/50"
                  data-testid="settings-search-result"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                    <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.label}</p>
                    {item.sectionLabel && (
                      <p className="truncate text-xs text-primary/80">
                        {t("settingsSearch.resultSection", { page: item.sectionLabel })}
                      </p>
                    )}
                    {item.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
                    )}
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
