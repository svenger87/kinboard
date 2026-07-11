"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { MapPin, Navigation, Loader2, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { WeatherLocation } from "@/hooks";

interface CityResult {
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  country: string;
  state?: string;
}

interface CityLocationPickerProps {
  value: WeatherLocation;
  onChange: (value: WeatherLocation) => void;
}

// NaN !== NaN, so a strict comparison would treat an echoed "in-progress
// coordinates" value (lat/lon still parsing to NaN while the field is
// empty or partial) as an external change and clobber the local text.
function sameNumber(a: number | undefined, b: number | undefined) {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}
function numberToInputText(n: number | undefined) {
  return n !== undefined && !Number.isNaN(n) ? String(n) : "";
}

// Shared by the weather settings page and the setup wizard's weather step —
// city autocomplete (debounced /api/cities search), coordinates mode, and
// browser geolocation. Owns its own search/suggestion state; the caller
// owns the committed WeatherLocation via value/onChange.
export function CityLocationPicker({ value, onChange }: CityLocationPickerProps) {
  const t = useTranslations("settings.weather");

  const [city, setCity] = useState(value.city ?? "");
  const [searchQuery, setSearchQuery] = useState(value.city ?? "");
  const [suggestions, setSuggestions] = useState<CityResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [lat, setLat] = useState(numberToInputText(value.lat));
  const [lon, setLon] = useState(numberToInputText(value.lon));
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Tracks the last value we emitted so the resync effect below can tell
  // "the parent echoed back what we just sent" apart from "the parent
  // hydrated us with a saved setting after mount" — only the latter should
  // overwrite in-progress local edits (e.g. a half-typed coordinate).
  const lastEmittedRef = useRef<WeatherLocation | null>(null);

  const emit = (next: WeatherLocation) => {
    lastEmittedRef.current = next;
    onChange(next);
  };

  useEffect(() => {
    const last = lastEmittedRef.current;
    const isOwnEcho =
      last &&
      last.type === value.type &&
      last.city === value.city &&
      sameNumber(last.lat, value.lat) &&
      sameNumber(last.lon, value.lon);
    if (isOwnEcho) return;

    setCity(value.city ?? "");
    setSearchQuery(value.city ?? "");
    setLat(numberToInputText(value.lat));
    setLon(numberToInputText(value.lon));
  }, [value.type, value.city, value.lat, value.lon]);

  // Debounced city search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (searchQuery.length < 2) {
      setSuggestions([]);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/cities?q=${encodeURIComponent(searchQuery)}`);
        if (response.ok) {
          const data = await response.json();
          setSuggestions(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        console.error("City search error:", error);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  const handleLocationTypeChange = (newType: "city" | "coordinates") => {
    if (newType === "city") {
      emit({ type: "city", city });
    } else {
      emit({ type: "coordinates", lat: parseFloat(lat), lon: parseFloat(lon) });
    }
  };

  const handleGetLocation = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const latStr = position.coords.latitude.toFixed(4);
          const lonStr = position.coords.longitude.toFixed(4);
          setLat(latStr);
          setLon(lonStr);
          emit({ type: "coordinates", lat: parseFloat(latStr), lon: parseFloat(lonStr) });
        },
        (error) => {
          console.error("Geolocation error:", error);
        }
      );
    }
  };

  const handleSelectCity = (cityResult: CityResult) => {
    setCity(cityResult.name);
    setSearchQuery(cityResult.displayName);
    setSuggestions([]);
    setShowSuggestions(false);
    emit({ type: "city", city: cityResult.name });
  };

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchQuery(newValue);
    setCity(newValue);
    setShowSuggestions(true);
    emit({ type: "city", city: newValue });
  };

  const handleLatChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLat(newValue);
    emit({ type: "coordinates", lat: parseFloat(newValue), lon: parseFloat(lon) });
  };

  const handleLonChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLon(newValue);
    emit({ type: "coordinates", lat: parseFloat(lat), lon: parseFloat(newValue) });
  };

  return (
    <>
      {/* Location Type */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mb-6"
      >
        <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
          {t("locationTypeHeading")}
        </h2>
        <Card className="p-4">
          <RadioGroup
            value={value.type}
            onValueChange={(newType) => handleLocationTypeChange(newType as "city" | "coordinates")}
            className="flex flex-col gap-3"
          >
            <div className="flex items-center gap-3">
              <RadioGroupItem value="city" id="city" />
              <Label htmlFor="city" className="flex items-center gap-2 cursor-pointer">
                <MapPin className="size-4" />
                {t("locationTypeCity")}
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <RadioGroupItem value="coordinates" id="coordinates" />
              <Label htmlFor="coordinates" className="flex items-center gap-2 cursor-pointer">
                <Navigation className="size-4" />
                {t("locationTypeCoordinates")}
              </Label>
            </div>
          </RadioGroup>
        </Card>
      </motion.div>

      {/* Location Input */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mb-6"
      >
        <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
          {value.type === "city" ? t("locationCityHeading") : t("locationCoordinatesHeading")}
        </h2>
        <Card className="p-4">
          {value.type === "city" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="city-input">{t("cityInputLabel")}</Label>
              <div className="relative">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    ref={inputRef}
                    id="city-input"
                    value={searchQuery}
                    onChange={handleSearchInputChange}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    placeholder={t("citySearchPlaceholder")}
                    className="pl-10"
                  />
                  {isSearching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />
                  )}
                </div>

                {/* Suggestions dropdown */}
                <AnimatePresence>
                  {showSuggestions && suggestions.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden"
                    >
                      {suggestions.map((result, index) => (
                        <button
                          key={`${result.lat}-${result.lon}-${index}`}
                          onClick={() => handleSelectCity(result)}
                          className="w-full px-4 py-3 text-left hover:bg-muted transition-colors flex items-center gap-3 border-b border-border/50 last:border-b-0"
                        >
                          <MapPin className="size-4 text-muted-foreground shrink-0" />
                          <div>
                            <p className="font-medium">{result.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {result.state ? `${result.state}, ` : ""}{result.country}
                            </p>
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("citySearchHint")}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="lat-input">{t("latLabel")}</Label>
                  <Input
                    id="lat-input"
                    type="number"
                    step="0.0001"
                    value={lat}
                    onChange={handleLatChange}
                    placeholder="53.5511"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="lon-input">{t("lonLabel")}</Label>
                  <Input
                    id="lon-input"
                    type="number"
                    step="0.0001"
                    value={lon}
                    onChange={handleLonChange}
                    placeholder="9.9937"
                  />
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGetLocation}
                className="w-full"
              >
                <Navigation className="size-4 mr-2" />
                {t("useCurrentLocation")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t("useCurrentLocationHint")}
              </p>
            </div>
          )}
        </Card>
      </motion.div>
    </>
  );
}
