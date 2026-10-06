"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Clock, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  loadEmojiCatalog,
  readRecentEmoji,
  readSkinTone,
  rememberEmoji,
  saveSkinTone,
  searchEmoji,
  withTone,
  type EmojiCatalog,
  type EmojiRow,
} from "@/lib/emoji/catalog";

/** Emoji per row of the grid; the arrow keys move by one and by a row. */
const COLUMNS = 8;
/** Drawn at a time: more follow as the grid scrolls, so a Pi never lays out 1,600 buttons at once. */
const CHUNK = 96;
const TONE_SWATCH = ["👋", "👋🏻", "👋🏼", "👋🏽", "👋🏾", "👋🏿"];

type Tab = "recent" | number;

/**
 * The emoji picker: the one icon picker for tasks and rewards. Every Unicode
 * emoji but the flags (lib/emoji/catalog.ts), searchable in the screen's
 * language and English, by category, with this device's recently used ones
 * first and a skin tone remembered per device.
 *
 * The data is loaded when the picker mounts -- it is only mounted while open.
 */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const t = useTranslations("emojiPicker");
  const locale = useLocale();
  const [catalog, setCatalog] = useState<EmojiCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [tone, setTone] = useState(0);
  const [tab, setTab] = useState<Tab>(0);
  const [shown, setShown] = useState(CHUNK);
  const gridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchId = useId();

  useEffect(() => {
    let live = true;
    const r = readRecentEmoji();
    setRecent(r);
    setTone(readSkinTone());
    if (r.length > 0) setTab("recent");
    loadEmojiCatalog(locale)
      .then((c) => live && setCatalog(c))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [locale]);

  // A name for each recently used emoji, from the catalogue (any tone).
  const nameOf = useMemo(() => {
    const names = new Map<string, string>();
    for (const row of catalog?.emoji ?? []) {
      names.set(row[0], row[2]);
      for (const v of row[4] ?? []) names.set(v, row[2]);
    }
    return names;
  }, [catalog]);

  const list: { emoji: string; name: string }[] = useMemo(() => {
    if (!catalog) return [];
    const rows: EmojiRow[] = query.trim()
      ? searchEmoji(catalog, query)
      : tab === "recent"
        ? []
        : catalog.emoji.filter((r) => r[1] === tab);
    if (!query.trim() && tab === "recent") return recent.map((e) => ({ emoji: e, name: nameOf.get(e) ?? e }));
    return rows.map((r) => ({ emoji: withTone(r, tone), name: r[2] }));
  }, [catalog, query, tab, tone, recent, nameOf]);

  // A new list starts at the top, one chunk drawn.
  useEffect(() => {
    setShown(CHUNK);
    gridRef.current?.scrollTo({ top: 0 });
  }, [query, tab, tone]);

  // The next chunk when the end of the drawn part scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || shown >= list.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((n) => n + CHUNK);
    }, { root: gridRef.current, rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, list.length]);

  const pick = useCallback((emoji: string) => {
    setRecent(rememberEmoji(emoji));
    onPick(emoji);
  }, [onPick]);

  // Arrow keys across the grid: one emoji left and right, one row up and down.
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[e.key];
    if (step === undefined) return;
    const buttons = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-emoji]") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(buttons.length - 1, at + step));
    if (next >= shown - COLUMNS) setShown((n) => Math.min(list.length, n + CHUNK));
    buttons[next]?.focus();
  };

  const tabs: { id: Tab; label: string; icon: string | null }[] = [
    ...(recent.length > 0 ? [{ id: "recent" as Tab, label: t("recent"), icon: null }] : []),
    ...(catalog?.groups ?? []).map((g, i) => ({
      id: i as Tab,
      label: g.label,
      icon: catalog?.emoji.find((r) => r[1] === i)?.[0] ?? null,
    })),
  ];

  const searching = query.trim().length > 0;
  const heading = searching
    ? t("results", { count: list.length })
    : tab === "recent"
      ? t("recent")
      : catalog?.groups[tab as number]?.label ?? "";

  return (
    <div className="flex w-full flex-col gap-2" data-testid="emoji-picker">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <label htmlFor={searchId} className="sr-only">{t("searchLabel")}</label>
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-9 pl-8"
          autoComplete="off"
          data-testid="emoji-search"
        />
      </div>

      <div className="flex items-center gap-1" role="radiogroup" aria-label={t("skinTone")}>
        {TONE_SWATCH.map((swatch, i) => (
          <button
            key={swatch}
            type="button"
            role="radio"
            aria-checked={tone === i}
            aria-label={t(`tone${i}` as never)}
            onClick={() => {
              setTone(i);
              saveSkinTone(i);
            }}
            className={cn("rounded-md p-0.5 text-base leading-none", tone === i ? "bg-primary/20 ring-1 ring-primary" : "opacity-70 hover:opacity-100")}
          >
            {swatch}
          </button>
        ))}
      </div>

      {!searching && (
        <div className="flex gap-0.5 overflow-x-auto pb-1" role="tablist" aria-label={t("categories")}>
          {tabs.map((tb) => (
            <button
              key={String(tb.id)}
              type="button"
              role="tab"
              aria-selected={tab === tb.id}
              aria-label={tb.label}
              title={tb.label}
              onClick={() => setTab(tb.id)}
              className={cn("shrink-0 rounded-md px-1.5 py-1 text-lg leading-none", tab === tb.id ? "bg-primary/20 ring-1 ring-primary" : "opacity-70 hover:opacity-100")}
              data-testid="emoji-tab"
            >
              {tb.icon ?? <Clock className="size-[18px]" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs font-medium text-muted-foreground" aria-live="polite">{catalog ? heading : failed ? t("loadFailed") : t("loading")}</p>

      <div
        ref={gridRef}
        role="group"
        aria-label={heading || t("searchLabel")}
        onKeyDown={onGridKey}
        className="max-h-56 overflow-y-auto overscroll-contain"
        data-testid="emoji-grid"
      >
        <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))` }}>
          {list.slice(0, shown).map(({ emoji, name }) => (
            <button
              key={emoji}
              type="button"
              data-emoji={emoji}
              aria-label={name}
              title={name}
              onClick={() => pick(emoji)}
              className="flex aspect-square items-center justify-center rounded-md text-xl leading-none hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {emoji}
            </button>
          ))}
        </div>
        {shown < list.length && <div ref={sentinelRef} className="h-4" aria-hidden="true" />}
        {catalog && searching && list.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("noResults")}</p>
        )}
      </div>
    </div>
  );
}

/**
 * An icon field: the chosen emoji (or none) on a button that opens the
 * picker; the picker can also take the icon away. One button wide, so it
 * fits a table row. Used by the task form and the rewards catalogue.
 */
export function EmojiIconField({
  value,
  onChange,
  label,
  id,
  className,
}: {
  value: string | null;
  onChange: (emoji: string | null) => void;
  /** The field's accessible name, e.g. "Task icon". */
  label: string;
  id?: string;
  className?: string;
}) {
  const t = useTranslations("emojiPicker");
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn("h-10 min-w-10 px-2 text-xl leading-none", className)}
          aria-label={value ? t("changeIcon", { label, icon: value }) : t("chooseIcon", { label })}
          data-testid="emoji-field"
        >
          {value || <span className="text-sm text-muted-foreground">{t("none")}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-3" align="start" data-testid="emoji-popover">
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-1 h-8 w-full justify-start gap-2 text-muted-foreground"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <X className="size-4" />
            {t("clear")}
          </Button>
        )}
        {open && (
          <EmojiPicker
            onPick={(emoji) => {
              onChange(emoji);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
