"use client";

import { useCallback, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { ListBox } from "@/components/layouts/list-box";

/**
 * What Home's list widgets share in a box (RFC-022 §3.1, §3.3): a themed card
 * that fills the box, its title linking to the widget's page, and a ListBox
 * of whole entries ending in a "+n" that links there too.
 *
 * Sizes are in em of the box's font size, so S to XL apply, except touch
 * targets: they are never shorter than 48px, whatever the text size. A box
 * too small for one more target shows one entry fewer; nothing shrinks.
 */

/** A touch target's height: 48px at least, more when the text is larger. */
export const TARGET_H = "min-h-[max(48px,2.4em)]";
/** A square touch target (an icon button): 48px at least. */
export const TARGET_SQ = "size-[max(48px,2.4em)] shrink-0 [&_svg]:size-[0.9em]";
/**
 * A checklist row (ChecklistItem): its text label, which fills the row and is
 * what a tap lands on, is the 48px target itself, not the row around it.
 */
export const CHECK_ROW = "gap-[0.5em] px-[0.6em] [&>label]:min-h-[max(48px,2.4em)] [&_label]:text-[0.9em]";

/**
 * The card of a Home list widget. The title row is a link to `href` (when the
 * widget has a page) and at least 48px tall; `badge` sits beside the title
 * (the count, so a box that fits no entry still says how many there are);
 * `actions` are the header's own buttons, each a TARGET_SQ. In the designer
 * (`editing`) the card is inert: arranging a box must not tick anything off.
 */
export function HomeListFrame({
  icon: Icon,
  title,
  href,
  badge,
  actions,
  editing,
  testId,
  children,
}: {
  icon: LucideIcon;
  title: string;
  href?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  editing?: boolean;
  testId: string;
  children: ReactNode;
}) {
  const heading = (
    <>
      <span className="flex shrink-0 items-center justify-center rounded-[0.5em] bg-primary/10 p-[0.35em] text-primary">
        <Icon className="size-[1em]" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="min-w-0 truncate font-display text-[1em] font-semibold leading-tight">{title}</span>
      {badge != null && <span className="shrink-0">{badge}</span>}
      {href && <ChevronRight className="size-[0.8em] shrink-0 text-muted-foreground" aria-hidden="true" />}
    </>
  );
  const headingClass = `${TARGET_H} flex min-w-0 flex-1 items-center gap-[0.5em] rounded-[0.5em] px-[0.25em]`;
  return (
    <section
      data-testid={testId}
      data-home-list
      inert={editing || undefined}
      className="accent-border-top flex size-full flex-col overflow-hidden rounded-[0.75em] border border-border bg-card text-card-foreground elev-sm"
    >
      <header className="flex shrink-0 items-center gap-[0.25em] px-[0.4em]">
        {href ? (
          <Link href={href} data-home-list-title className={`${headingClass} transition-colors hover:bg-accent/50`}>
            {heading}
          </Link>
        ) : (
          <div data-home-list-title className={headingClass}>
            {heading}
          </div>
        )}
        {actions}
      </header>
      <div className="min-h-0 flex-1 px-[0.5em] pb-[0.15em]">{children}</div>
    </section>
  );
}

/** The count beside a list's title. */
export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span data-home-list-count className="rounded-full bg-muted px-[0.5em] py-[0.1em] text-[0.7em] font-medium tabular-nums text-muted-foreground">
      {count}
    </span>
  );
}

/** "+n more", as the screensaver's lists say it. */
export function useHomeMoreLabel() {
  const t = useTranslations("components.layouts");
  return useCallback((count: number) => t("more", { count }), [t]);
}

/**
 * As many whole entries as fit, then "+n": a 48px link to `href`, or plain
 * text when the widget has no page of its own. When not even one entry fits,
 * the "+n" line is hidden too (it would be cut): the title still links to
 * the page and its badge carries the count.
 */
export function HomeList<T>({
  items,
  keyOf,
  renderItem,
  empty,
  href,
}: {
  items: T[];
  keyOf: (t: T) => string;
  renderItem: (t: T) => ReactNode;
  empty: ReactNode;
  href?: string;
}) {
  const moreLabel = useHomeMoreLabel();
  const renderMore = useCallback(
    (_n: number, label: string) =>
      href ? (
        <Link
          href={href}
          data-home-list-more
          className={`${TARGET_H} flex items-center justify-center gap-[0.25em] rounded-[0.5em] text-[0.8em] font-medium text-primary/80 transition-colors hover:bg-accent/50 hover:text-primary`}
        >
          <span>{label}</span>
          <ChevronRight className="size-[1em]" aria-hidden="true" />
        </Link>
      ) : (
        <p data-home-list-more className="py-[0.25em] text-center text-[0.8em] font-medium text-muted-foreground">
          {label}
        </p>
      ),
    [href],
  );
  return (
    <div className="size-full [&_[data-list-shown='0']_[data-testid=list-more]]:hidden">
      <ListBox items={items} keyOf={keyOf} renderItem={renderItem} empty={empty} moreLabel={moreLabel} renderMore={renderMore} gap={HOME_ROW_GAP} />
    </div>
  );
}

/** Room between entries, in px (ListBox's gap). A gap after the last entry would cost a 48px row its place in a small box. */
export const HOME_ROW_GAP = 6;

/** A list with nothing in it. */
export function HomeEmptyLine({ text }: { text: string }) {
  return <p className="py-[0.25em] text-[0.8em] text-muted-foreground">{text}</p>;
}

/** An entry's card, on the app's theme. */
export const HOME_ROW = "flex items-center gap-[0.5em] rounded-[0.6em] border border-border bg-card px-[0.6em] py-[0.3em] elev-sm";
/** An entry's card that ends in a 48px button: the button sets its height. */
export const HOME_ROW_BUTTON = "flex items-center gap-[0.5em] rounded-[0.6em] border border-border bg-card pl-[0.6em] elev-sm";
