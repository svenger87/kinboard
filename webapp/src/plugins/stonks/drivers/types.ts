import type { ComponentType } from "react";
import type { Ticker } from "@/types/database";

export interface StonksDriver {
  id: string;
  displayNameKey: string;
  icon: ComponentType<{ className?: string; size?: number }>;
  /** Detail page render — full quote + chart + timeframe tabs. */
  Card: ComponentType<{ ticker: Ticker }>;
  /** Compact dashboard render — symbol + price + day-change %. */
  WidgetCard: ComponentType<{ ticker: Ticker }>;
  /** Inline form for per-ticker config (nickname, color) — rendered
   *  inside the settings/stonks list row's expand UI. */
  ConfigForm: ComponentType<{
    ticker: Ticker;
    onChange: (patch: { nickname?: string | null; color?: string | null }) => void;
  }>;
}
