"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * As many WHOLE entries as fit the box's height, then a "+n" line for the
 * rest, which is kept a line of room when not everything fits. All entries
 * are rendered in a hidden pass and measured, so entries of different heights
 * and wrapped text count correctly. Measured again when the box resizes and
 * when the items change. An empty list shows `empty` in the same box.
 *
 * `keyOf` gives each entry its React key.
 */
export function ListBox<T>({
  items,
  renderItem,
  keyOf,
  empty,
  moreLabel,
  gap = 0,
}: {
  items: T[];
  renderItem: (t: T) => ReactNode;
  keyOf: (t: T) => string;
  empty: ReactNode;
  moreLabel: (n: number) => string;
  gap?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const measuring = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    const m = measuring.current;
    if (!el || !m || items.length === 0) return;
    const measure = () => {
      const avail = el.clientHeight;
      const rows = Array.from(m.children) as HTMLElement[];
      const heights = rows.map((r) => r.offsetHeight);
      const moreH = moreRef.current?.offsetHeight ?? 0;
      const fits = (n: number, reserve: number) => {
        let used = 0;
        for (let i = 0; i < n; i++) used += heights[i] + (i > 0 ? gap : 0);
        return used + (reserve > 0 ? (n > 0 ? gap : 0) + reserve : 0) <= avail;
      };
      let n = heights.length;
      if (!fits(n, 0)) {
        n = n - 1;
        while (n > 0 && !fits(n, moreH)) n--;
      }
      setShown((prev) => (prev === n ? prev : n));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(m);
    return () => ro.disconnect();
  }, [items, gap, moreLabel]);

  if (items.length === 0) {
    return (
      <div data-list-shown={0} data-list-more={0} style={{ width: "100%", height: "100%", overflow: "hidden" }}>
        {empty}
      </div>
    );
  }

  const n = Math.min(shown ?? 0, items.length);
  const more = items.length - n;
  return (
    <div
      ref={root}
      data-list-shown={n}
      data-list-more={more}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
    >
      <div data-list-visible style={{ display: "flex", flexDirection: "column", gap }}>
        {items.slice(0, n).map((t) => (
          <div key={keyOf(t)}>{renderItem(t)}</div>
        ))}
        {more > 0 && <div data-testid="list-more">{moreLabel(more)}</div>}
      </div>
      {/* Hidden pass: every entry at its natural height, plus the "+n" line. */}
      <div
        ref={measuring}
        aria-hidden
        style={{ position: "absolute", left: 0, right: 0, top: 0, visibility: "hidden", pointerEvents: "none", display: "flex", flexDirection: "column", gap }}
      >
        {items.map((t) => (
          <div key={keyOf(t)}>{renderItem(t)}</div>
        ))}
      </div>
      <div ref={moreRef} aria-hidden style={{ position: "absolute", left: 0, right: 0, top: 0, visibility: "hidden", pointerEvents: "none" }}>
        {moreLabel(items.length)}
      </div>
    </div>
  );
}
