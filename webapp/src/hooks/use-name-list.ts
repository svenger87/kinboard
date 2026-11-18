import { useMemo } from "react";
import { useLocale } from "next-intl";

/** Joins names the way the page's language does: "Küche, Flur und Bad", "Küche, Flur and Bad". */
export function useNameList(): (names: string[]) => string {
  const locale = useLocale();
  return useMemo(() => {
    const list = new Intl.ListFormat(locale, { type: "conjunction" });
    return (names: string[]) => list.format(names);
  }, [locale]);
}
