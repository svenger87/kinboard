import { create } from "zustand";
import type { WeatherEffect } from "@/lib/weather-effects";

/**
 * The weather effects showing on Home right now, and the wind's gust, as the
 * overlay (components/weather-effects.tsx) works them out: the real weather
 * against the family's thresholds, or a Preview. The creatures on Home react
 * to exactly what is on the screen (components/creatures-on-home.tsx).
 *
 * A store rather than a second copy of the overlay's arithmetic, so the two
 * can never disagree. Nothing showing (the effects switched off, a calm day,
 * no Home on screen) is an empty list.
 */
interface HomeWeatherState {
  effects: readonly WeatherEffect[];
  /** 0 when calm, 1 to 2 when windy: the overlay's own gust. */
  gust: number;
  setHomeWeather: (effects: readonly WeatherEffect[], gust: number) => void;
}

export const useHomeWeather = create<HomeWeatherState>((set) => ({
  effects: [],
  gust: 0,
  setHomeWeather: (effects, gust) => set({ effects, gust }),
}));
