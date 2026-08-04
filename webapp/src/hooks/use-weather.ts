"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { useSetting } from "./use-supabase-queries";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import {
  DEFAULT_UNIT_SYSTEM,
  unitLabels,
  type UnitSystem,
  type UnitLabels,
} from "@/lib/weather-units";

export interface WeatherData {
  temp: number;
  feelsLike: number;
  condition: string;
  conditionMain?: string;
  conditionIcon: string;
  humidity: number;
  windSpeed: number;
  location: string;
  high: number;
  low: number;
  visibility: number;
  sunrise: string;
  sunset: string;
  /** Seconds east of UTC at the weather location. */
  timezoneOffset?: number;
  units?: UnitSystem;
}

export interface DailyForecast {
  date: string;
  dayName: string;
  tempMax: number;
  tempMin: number;
  condition: string;
  conditionMain?: string;
  conditionIcon: string;
  humidity: number;
  windSpeed: number;
  precipProbability: number;
  rainAmount: number;
  snowAmount: number;
}

export interface HourlyForecast {
  time: string;
  temp: number;
  condition: string;
  conditionMain?: string;
  conditionIcon: string;
  precipProbability: number;
  windSpeed: number;
}

export interface ForecastData {
  location: string;
  coords: { lat: number; lon: number };
  timezone: number;
  daily: DailyForecast[];
  hourly: HourlyForecast[];
  units?: UnitSystem;
}

export interface WeatherMapConfig {
  center: { lat: number; lon: number };
  zoom: number;
  layers: {
    precipitation: string;
    clouds: string;
    temperature: string;
    wind: string;
    pressure: string;
  };
  baseLayer: string;
  attribution: string;
}

export interface WeatherLocation {
  type: "city" | "coordinates";
  city?: string;
  lat?: number;
  lon?: number;
}

const DEFAULT_LOCATION: WeatherLocation = {
  type: "city",
  city: "Hamburg",
};

/**
 * The household's unit system, plus the labels to render it with.
 *
 * Stored per family rather than per device: a household picks one system
 * and every screen in the house should agree, the same way the locale
 * and holiday country already work.
 */
export function useWeatherUnits(): {
  system: UnitSystem;
  labels: UnitLabels;
  isLoading: boolean;
} {
  const { data, isLoading } = useSetting<UnitSystem>(
    SETTINGS_KEYS.weatherUnits,
    DEFAULT_UNIT_SYSTEM,
  );
  const system = data ?? DEFAULT_UNIT_SYSTEM;
  return { system, labels: unitLabels(system), isLoading };
}

export function useWeatherLocation() {
  return useSetting<WeatherLocation>(SETTINGS_KEYS.weatherLocation, DEFAULT_LOCATION);
}

export function useWeather() {
  const locale = useLocale();
  const { data: location, isLoading: locationLoading } = useWeatherLocation();
  const { system: units, isLoading: unitsLoading } = useWeatherUnits();
  const weatherLocation = location || DEFAULT_LOCATION;

  return useQuery({
    // `units` is part of the key: switching systems must refetch rather
    // than relabel cached Celsius numbers as Fahrenheit.
    queryKey: ["weather", weatherLocation, locale, units],
    queryFn: async (): Promise<WeatherData | null> => {
      let url = "/api/weather?";

      if (weatherLocation.type === "coordinates" && weatherLocation.lat != null && weatherLocation.lon != null) {
        url += `lat=${weatherLocation.lat}&lon=${weatherLocation.lon}`;
      } else if (weatherLocation.city) {
        url += `city=${encodeURIComponent(weatherLocation.city)}`;
      } else {
        throw new Error("No weather location configured");
      }

      url += `&lang=${locale}&units=${units}`;

      const response = await fetch(url);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fetch weather");
      }

      const data = await response.json();
      // Server returns { configured: false } when OPENWEATHERMAP_API_KEY is unset.
      // Treat as "no data" so the widget can render its empty state instead of an error.
      if (data && data.configured === false) return null;
      return data;
    },
    enabled: !locationLoading && !unitsLoading,
    staleTime: 10 * 60 * 1000, // 10 minutes
    refetchInterval: 15 * 60 * 1000, // Refetch every 15 minutes
    retry: 2,
  });
}

export function useWeatherForecast() {
  const locale = useLocale();
  const { data: location, isLoading: locationLoading } = useWeatherLocation();
  const { system: units, isLoading: unitsLoading } = useWeatherUnits();
  const weatherLocation = location || DEFAULT_LOCATION;

  return useQuery({
    queryKey: ["weather", "forecast", weatherLocation, locale, units],
    queryFn: async (): Promise<ForecastData | null> => {
      let url = "/api/weather/forecast?";

      if (weatherLocation.type === "coordinates" && weatherLocation.lat != null && weatherLocation.lon != null) {
        url += `lat=${weatherLocation.lat}&lon=${weatherLocation.lon}`;
      } else if (weatherLocation.city) {
        url += `city=${encodeURIComponent(weatherLocation.city)}`;
      } else {
        throw new Error("No weather location configured");
      }

      url += `&lang=${locale}&units=${units}`;

      const response = await fetch(url);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fetch forecast");
      }

      const data = await response.json();
      if (data && data.configured === false) return null;
      return data;
    },
    enabled: !locationLoading && !unitsLoading,
    staleTime: 30 * 60 * 1000, // 30 minutes
    refetchInterval: 60 * 60 * 1000, // Refetch every hour
    retry: 2,
  });
}

export function useWeatherMapConfig() {
  const { data: location, isLoading: locationLoading } = useWeatherLocation();
  const weatherLocation = location || DEFAULT_LOCATION;

  return useQuery({
    queryKey: ["weather", "map", weatherLocation],
    queryFn: async (): Promise<WeatherMapConfig> => {
      // First we need coordinates
      let lat: number, lon: number;

      if (weatherLocation.type === "coordinates" && weatherLocation.lat != null && weatherLocation.lon != null) {
        lat = weatherLocation.lat;
        lon = weatherLocation.lon;
      } else if (weatherLocation.city) {
        // Get coordinates from city using the geocoding API
        const geoResponse = await fetch(`/api/cities?q=${encodeURIComponent(weatherLocation.city)}&limit=1`);
        if (!geoResponse.ok) {
          throw new Error("Failed to get coordinates for city");
        }
        const cities = await geoResponse.json();
        if (!Array.isArray(cities) || !cities.length) {
          throw new Error("City not found");
        }
        lat = cities[0].lat;
        lon = cities[0].lon;
      } else {
        throw new Error("No weather location configured");
      }

      const response = await fetch(`/api/weather/map?lat=${lat}&lon=${lon}`);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fetch map config");
      }

      return response.json();
    },
    enabled: !locationLoading,
    staleTime: 60 * 60 * 1000, // 1 hour
    retry: 2,
  });
}
