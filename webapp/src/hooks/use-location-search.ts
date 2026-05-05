import { useState, useCallback, useRef } from "react";

export interface LocationResult {
  display_name: string;
  place_id: number;
  lat: string;
  lon: string;
  address?: {
    road?: string;
    house_number?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

interface UseLocationSearchOptions {
  debounceMs?: number;
  limit?: number;
  countryCode?: string;
}

export function useLocationSearch(options: UseLocationSearchOptions = {}) {
  const { debounceMs = 300, limit = 5, countryCode = "de" } = options;

  const [results, setResults] = useState<LocationResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const abortController = useRef<AbortController | null>(null);

  const search = useCallback(
    (query: string) => {
      // Clear previous timer
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      // Cancel previous request
      if (abortController.current) {
        abortController.current.abort();
      }

      // Clear results if query is too short
      if (query.length < 3) {
        setResults([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      debounceTimer.current = setTimeout(async () => {
        abortController.current = new AbortController();

        try {
          const params = new URLSearchParams({
            q: query,
            format: "json",
            addressdetails: "1",
            limit: limit.toString(),
            countrycodes: countryCode,
          });

          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?${params}`,
            {
              signal: abortController.current.signal,
              headers: {
                "Accept-Language": "de",
                "User-Agent": "FamilyCalendar/1.0",
              },
            }
          );

          if (!response.ok) {
            throw new Error("Search failed");
          }

          const data: LocationResult[] = await response.json();
          setResults(data);
          setError(null);
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            // Ignore abort errors
            return;
          }
          setError("Suche fehlgeschlagen");
          setResults([]);
        } finally {
          setIsLoading(false);
        }
      }, debounceMs);
    },
    [debounceMs, limit, countryCode]
  );

  const clear = useCallback(() => {
    setResults([]);
    setError(null);
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    if (abortController.current) {
      abortController.current.abort();
    }
  }, []);

  // Format a location result into a short display string
  const formatLocation = useCallback((location: LocationResult): string => {
    const addr = location.address;
    if (!addr) return location.display_name;

    const parts: string[] = [];

    // Street with house number
    if (addr.road) {
      parts.push(addr.house_number ? `${addr.road} ${addr.house_number}` : addr.road);
    }

    // City/Town/Village
    const city = addr.city || addr.town || addr.village || addr.municipality;
    if (city) {
      parts.push(addr.postcode ? `${addr.postcode} ${city}` : city);
    }

    return parts.length > 0 ? parts.join(", ") : location.display_name;
  }, []);

  return {
    results,
    isLoading,
    error,
    search,
    clear,
    formatLocation,
  };
}
