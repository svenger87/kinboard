"use client";

import { createContext, useContext } from "react";
import type { NewsItem } from "@/hooks";

/**
 * What a designed screensaver's widgets can do when tapped, handed down by
 * the screensaver that draws them. Empty in the designer, where a tap selects
 * the widget instead.
 */
export interface SaverActions {
  /** Opens a news item in the screensaver's news modal. */
  onSelectNews?: (item: NewsItem) => void;
}

const SaverActionsContext = createContext<SaverActions>({});

export const SaverActionsProvider = SaverActionsContext.Provider;

export function useSaverActions(): SaverActions {
  return useContext(SaverActionsContext);
}
