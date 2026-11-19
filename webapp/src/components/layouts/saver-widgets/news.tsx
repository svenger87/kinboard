"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Newspaper } from "lucide-react";
import type { NewsItem } from "@/hooks";
import { ListBox } from "@/components/layouts/list-box";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { useSaverActions } from "@/components/layouts/saver-actions";
import { NewsCard, useNewsTime } from "@/components/screensaver-rows";
import {
  EmptyLine,
  ListFrame,
  RowGap,
  useMoreLabel,
  type SaverWidgetProps,
} from "./shared";

const keyOf = (n: NewsItem) => n.link;
const NONE: NewsItem[] = [];

/**
 * The news feed's latest items as the built-in screensaver's cards, as many as
 * fit the box. On the screensaver a tap opens the item in the news modal, as
 * on the built-in one, without waking the screen (data-no-wake).
 */
export function NewsWidget(_: SaverWidgetProps) {
  const { news } = useScreensaverDataContext();
  const t = useTranslations("components.screensaver");
  const tl = useTranslations("components.layouts");
  const newsTime = useNewsTime();
  const moreLabel = useMoreLabel();
  const items = useMemo(() => news ?? NONE, [news]);
  const { onSelectNews } = useSaverActions();
  return (
    <div className="size-full" data-no-wake={onSelectNews ? "" : undefined}>
      <ListFrame icon={Newspaper} label={t("newsLabel")}>
        <ListBox
          items={items}
          keyOf={keyOf}
          renderItem={(n) => (
            <RowGap>
              <NewsCard
                item={n}
                time={newsTime(n.pubDate)}
                scale="box"
                onSelect={onSelectNews}
              />
            </RowGap>
          )}
          empty={<EmptyLine text={tl("empty.news")} />}
          moreLabel={moreLabel}
        />
      </ListFrame>
    </div>
  );
}
