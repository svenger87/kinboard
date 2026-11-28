"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import {
  categoryForIndexHash,
  SETTINGS_CATEGORIES,
  type SettingsCategory,
} from "@/lib/settings-search/registry";

function readHash(): string {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return ""; // A malformed hash (%E0%A4%A) names nothing.
  }
}

const rowId = (id: SettingsCategory) => `settings-category-${id}`;
const panelId = (id: SettingsCategory) => `settings-category-${id}-panel`;

/**
 * Which settings category is open, kept in the URL's hash.
 *
 * On load and on every `hashchange`, `/settings#calendars` opens Calendars and
 * `/settings#pin` opens the category that holds the PIN card (the scroll to
 * the card itself is `useSettingsAnchor`'s, which waits until it is visible).
 * Opening or closing a row writes the hash with `replaceState`: no history
 * entry per tap, but Back from a page opened from the row comes back to it
 * open.
 */
export function useOpenSettingsCategory() {
  const [open, setOpen] = useState<SettingsCategory | null>(null);
  // A category named by the hash itself is scrolled to once it has rendered.
  const [scrollTo, setScrollTo] = useState<SettingsCategory | null>(null);

  useEffect(() => {
    const fromHash = () => {
      const hash = readHash();
      const category = categoryForIndexHash(hash);
      if (!category) return;
      setOpen(category);
      if (hash === category) setScrollTo(category);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  useEffect(() => {
    if (!scrollTo) return;
    // The install's row appears only once the operator check has answered:
    // look for it for a few seconds, as useSettingsAnchor does for a card.
    const started = performance.now();
    let frame = 0;
    const find = () => {
      const row = document.getElementById(rowId(scrollTo));
      if (row) {
        row.scrollIntoView({ block: "nearest" });
        setScrollTo(null);
      } else if (performance.now() - started < 5000) {
        frame = requestAnimationFrame(find);
      } else {
        setScrollTo(null);
      }
    };
    frame = requestAnimationFrame(find);
    return () => cancelAnimationFrame(frame);
  }, [scrollTo]);

  const toggle = useCallback(
    (id: SettingsCategory) => {
      const next = open === id ? null : id;
      setOpen(next);
      const url = `${window.location.pathname}${window.location.search}${next ? `#${next}` : ""}`;
      window.history.replaceState(window.history.state, "", url);
      if (next) setScrollTo(next);
    },
    [open],
  );

  return { open, toggle };
}

export interface SettingsCategoryItem {
  id: SettingsCategory;
  /** One line under the name: what is inside, or its state (the family code). */
  summary: string;
  /** Something inside needs someone: a dot on the row, red for a fault, amber otherwise. */
  attention?: "warning" | "error";
  /** Not shown at all (the install's own category, for everyone but its operator). */
  hidden?: boolean;
  /** Null when everything in it is hidden (plugins switched off): the row goes too. */
  content: ReactNode;
}

/**
 * The settings index as collapsible categories, one open at a time. Each row
 * is a button in a heading (`aria-expanded`, `aria-controls`); the panels of
 * closed rows stay in the page but `hidden`, so a deep link can find the card
 * it names and open the row around it. Up and Down move between rows, Home
 * and End to the first and last.
 */
export function SettingsCategories({
  items,
  open,
  onToggle,
}: {
  items: SettingsCategoryItem[];
  open: SettingsCategory | null;
  onToggle: (id: SettingsCategory) => void;
}) {
  const t = useTranslations("settings.categories");
  const listRef = useRef<HTMLDivElement>(null);
  const byId = new Map(items.map((i) => [i.id, i]));
  const shown = SETTINGS_CATEGORIES.flatMap((c) => {
    const item = byId.get(c.id);
    return item && !item.hidden && item.content ? [{ ...c, ...item }] : [];
  });

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-category-row]") ?? []);
    const at = rows.indexOf(e.currentTarget);
    const to =
      e.key === "ArrowDown" ? rows[(at + 1) % rows.length]
      : e.key === "ArrowUp" ? rows[(at - 1 + rows.length) % rows.length]
      : e.key === "Home" ? rows[0]
      : e.key === "End" ? rows[rows.length - 1]
      : undefined;
    if (!to) return;
    e.preventDefault();
    to.focus();
  };

  return (
    <div ref={listRef} className="space-y-2" data-testid="settings-categories">
      {shown.map((c) => {
        const isOpen = open === c.id;
        const Icon = c.icon;
        return (
          <section
            key={c.id}
            data-settings-category={c.id}
            data-open={isOpen ? "" : undefined}
            className={`rounded-2xl border bg-card elev-sm transition-colors ${
              isOpen ? "border-primary/40" : "border-border"
            }`}
          >
            <h2 className="m-0">
              <button
                type="button"
                id={rowId(c.id)}
                data-category-row
                aria-expanded={isOpen}
                aria-controls={panelId(c.id)}
                onClick={() => onToggle(c.id)}
                onKeyDown={onKeyDown}
                className="flex w-full min-h-16 [@media(max-height:960px)]:min-h-14 items-center gap-3 rounded-2xl px-4 py-2.5 [@media(max-height:960px)]:py-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold leading-snug">{t(`names.${c.id}`)}</span>
                  <span className="block truncate text-xs text-muted-foreground" data-testid="settings-category-summary">
                    {c.summary}
                  </span>
                </span>
                {c.attention && (
                  <span className="flex shrink-0 items-center" data-testid="settings-category-attention" data-attention={c.attention}>
                    <span
                      className={`block size-2.5 rounded-full ${c.attention === "error" ? "bg-destructive" : "bg-warning"}`}
                      aria-hidden="true"
                    />
                    <span className="sr-only">{t("needsAttention")}</span>
                  </span>
                )}
                <ChevronDown
                  className={`size-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
            </h2>
            <div
              id={panelId(c.id)}
              role="region"
              aria-labelledby={rowId(c.id)}
              hidden={!isOpen}
              className="space-y-3 px-3 pb-3"
            >
              {c.content}
            </div>
          </section>
        );
      })}
    </div>
  );
}
