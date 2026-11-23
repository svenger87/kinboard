"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { HomeData } from "@/hooks/use-home-data";

export type { HomeData };

const HomeDataContext = createContext<HomeData | null>(null);

/**
 * Hands Home's shared data to the widgets drawn in a designed Home's boxes
 * (RFC-022 step 4). Whoever renders Home calls `useHomeData` once, with the
 * needs of the widgets it places, and passes the result here; the result is
 * already memoised, so the widgets' effects see a new value only when the
 * data changed. The counterpart of `ScreensaverDataProvider`.
 */
export function HomeDataProvider({ value, children }: { value: HomeData; children: ReactNode }) {
  return <HomeDataContext.Provider value={value}>{children}</HomeDataContext.Provider>;
}

export function useHomeDataContext(): HomeData {
  const value = useContext(HomeDataContext);
  if (!value) {
    throw new Error(
      "useHomeDataContext: no HomeDataProvider above this widget. Render Home widgets inside Home (or a HomeDataProvider fed by useHomeData).",
    );
  }
  return value;
}
