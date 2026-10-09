import { useState, useCallback, useRef } from "react";
import { formatPlace, type LocationResult } from "@/lib/location-search";

export type { LocationResult } from "@/lib/location-search";

interface UseLocationSearchOptions {
  debounceMs?: number;
  limit?: number;
  /** The app's language: the names in the results come back in it. */
  language?: string;
  /** Where the family is: nearby places first, the rest of the world after. */
  near?: { lat: number; lon: number } | null;
  /** ...or the town it is in, when the weather location is a town rather than coordinates. */
  nearTown?: string | null;
  /**
   * ISO 3166-1 alpha-2. Used only when where the family is is unknown, so a
   * family with no weather location is still searched in its own country.
   */
  countryCode?: string | null;
}

/**
 * The Location field's place search: one request per pause in typing, to
 * Kinboard's own /api/geocode (Photon behind a cache, lib/photon-client.ts).
 * Nearby places come first without the rest of the world being left out, so
 * there is no second, worldwide request to make.
 */
export function useLocationSearch(options: UseLocationSearchOptions = {}) {
  const { debounceMs = 300, limit = 5, language = "en", near, nearTown, countryCode } = options;

  const [results, setResults] = useState<LocationResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const abortController = useRef<AbortController | null>(null);

  const search = useCallback(
    (query: string) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (abortController.current) abortController.current.abort();

      if (query.trim().length < 3) {
        setResults([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      debounceTimer.current = setTimeout(async () => {
        const controller = new AbortController();
        abortController.current = controller;

        const params = new URLSearchParams({ q: query.trim(), limit: String(limit), lang: language });
        if (near) {
          params.set("lat", String(near.lat));
          params.set("lon", String(near.lon));
        } else if (nearTown) {
          params.set("near", nearTown);
        }
        if (countryCode) params.set("country", countryCode);

        try {
          const response = await fetch(`/api/geocode?${params}`, { signal: controller.signal });
          if (!response.ok) throw new Error("Location search failed");
          const body = (await response.json()) as { results?: LocationResult[] };
          setResults(body.results ?? []);
          setError(null);
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return;
          setError("Location search failed");
          setResults([]);
        } finally {
          if (!controller.signal.aborted) setIsLoading(false);
        }
      }, debounceMs);
    },
    [debounceMs, limit, language, near, nearTown, countryCode],
  );

  const clear = useCallback(() => {
    setResults([]);
    setError(null);
    // An aborted request leaves loading to whoever aborted it; here, nobody follows.
    setIsLoading(false);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (abortController.current) abortController.current.abort();
  }, []);

  // A result as one short line, written the way its own country writes an
  // address, led by the place's own name when it has one.
  const formatLocation = useCallback(
    (location: LocationResult): string => formatPlace(location.address, location.display_name),
    [],
  );

  return {
    results,
    isLoading,
    error,
    search,
    clear,
    formatLocation,
  };
}
