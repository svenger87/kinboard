import { create } from "zustand";
import type { WeatherEffect } from "@/lib/weather-effects";

/** The two floors creatures walk on: Home's, and the screensaver's bottom edge. */
export type CreatureFloorPlace = "home" | "idle";

export interface FloorWeather {
  effects: readonly WeatherEffect[];
  /** 0 when calm, 1 to 2 when windy: the overlay's own gust. */
  gust: number;
}

/**
 * The weather effects showing right now on Home and on the screensaver, and
 * the wind's gust, as each one's overlay (components/weather-effects.tsx)
 * works them out: the real weather against the family's thresholds, or a
 * Preview. The creatures on each floor react to exactly what is on that
 * screen (components/creatures-on-home.tsx).
 *
 * A store rather than a second copy of the overlay's arithmetic, so the two
 * can never disagree. One entry per floor: Home stays mounted under the
 * screensaver, and its overlay must not overwrite what the screensaver shows.
 * Nothing showing (the effects switched off, a calm day, the screen not up)
 * is an empty list.
 */
interface FloorWeatherState {
  home: FloorWeather;
  idle: FloorWeather;
  setFloorWeather: (floor: CreatureFloorPlace, effects: readonly WeatherEffect[], gust: number) => void;
}

export const useFloorWeather = create<FloorWeatherState>((set) => ({
  home: { effects: [], gust: 0 },
  idle: { effects: [], gust: 0 },
  setFloorWeather: (floor, effects, gust) => set({ [floor]: { effects, gust } } as Pick<FloorWeatherState, CreatureFloorPlace>),
}));
